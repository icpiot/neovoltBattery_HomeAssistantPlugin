"""Single source of truth for battery + grid feed-in settings.

Owns the server cache, the pending diff, and serializes refresh/submit
behind a lock. Entities call ``effective_*()`` to read, ``stage_*()`` to
write (with validation). The Submit button calls ``submit()`` to push
everything to the API in one shot; on per-batch failure the failed
batch's pending changes are preserved so the UI does not lie to the user.

Concurrency model
-----------------
- ``stage_*`` / ``discard`` are sync and lock-free. They mutate the
  pending dicts directly. Safe in asyncio's single-threaded model so
  long as no awaits sit between read and write inside any one of them.
- ``refresh`` / ``submit`` take an ``asyncio.Lock`` to serialize against
  each other across await points.
- ``submit`` uses a snapshot-clear-restore pattern: it atomically
  (no awaits in between) moves pending into a local snapshot and
  resets pending to empty BEFORE the API call. Any ``stage_*`` that
  fires while the submit is in flight lands in the fresh pending and
  survives the submit. On per-batch failure, the snapshot is merged
  back into pending (without overwriting any newer values the user
  staged during submit).
- ``_battery_submitted_at`` / ``_feedin_submitted_at`` carry a short
  "trust local cache" window after a successful submit. Subsequent
  refreshes skip the corresponding batch for that window, since the
  Byte-Watt API is not strictly read-after-write consistent — without
  this guard the UI can flick back to stale values for one poll cycle.
"""
from __future__ import annotations

import asyncio
import copy
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util

from .api.settings import BatterySettingsAPI, ForceChargeAPI, GridFeedInSettingsAPI
from .const import (
    BATTERY_DAILY_MAX_SLOTS,
    BATTERY_WEEKLY_MAX_SLOTS,
    FEEDIN_MAX_SLOTS,
    signal_pending_changed,
)
from .models import ChargeSlot, CycleStrategy, DischargeSlot, GridFeedInSettings, GridFeedInSlot
from .topology import ByteWattScope
from .utilities.time_utils import sanitize_time_format

_LOGGER = logging.getLogger(__name__)


class SettingsValidationError(ValueError):
    """Raised when a staged value fails validation."""


@dataclass
class SubmitResult:
    """Per-batch outcome of a submit() call."""
    battery_attempted: bool = False
    battery_ok: bool = False
    battery_error: Optional[str] = None
    feedin_attempted: bool = False
    feedin_ok: bool = False
    feedin_error: Optional[str] = None

    @property
    def all_ok(self) -> bool:
        if not (self.battery_attempted or self.feedin_attempted):
            return True
        if self.battery_attempted and not self.battery_ok:
            return False
        if self.feedin_attempted and not self.feedin_ok:
            return False
        return True

    @property
    def any_attempted(self) -> bool:
        return self.battery_attempted or self.feedin_attempted


# -- Validators ------------------------------------------------------------

def _v_soc(name: str, value: Any) -> int:
    try:
        iv = int(value)
    except (TypeError, ValueError) as ex:
        raise SettingsValidationError(f"{name} must be an integer, got {value!r}") from ex
    if not 1 <= iv <= 100:
        raise SettingsValidationError(f"{name} must be 1..100, got {iv}")
    return iv


def _v_time(name: str, value: Any) -> str:
    sanitized = sanitize_time_format(value)
    if sanitized is None:
        raise SettingsValidationError(f"{name} must be HH:MM, got {value!r}")
    return sanitized


def _v_bool(name: str, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lower = value.strip().lower()
        if lower in ("true", "1", "on", "yes"):
            return True
        if lower in ("false", "0", "off", "no"):
            return False
    raise SettingsValidationError(f"{name} must be boolean-like, got {value!r}")


def _v_battery_power(name: str, value: Any) -> int:
    """Charge/discharge power: realistic inverter range."""
    try:
        iv = int(value)
    except (TypeError, ValueError) as ex:
        raise SettingsValidationError(f"{name} must be an integer, got {value!r}") from ex
    if not 0 <= iv <= 50000:
        raise SettingsValidationError(f"{name} must be 0..50000 W, got {iv}")
    return iv


def _v_feedin_power(name: str, value: Any) -> int:
    """Grid feed-in power: hardware top end ~20 kW."""
    try:
        iv = int(value)
    except (TypeError, ValueError) as ex:
        raise SettingsValidationError(f"{name} must be an integer, got {value!r}") from ex
    if not 0 <= iv <= 20000:
        raise SettingsValidationError(f"{name} must be 0..20000 W, got {iv}")
    return iv


def _v_cutoff_soc(name: str, value: Any) -> float:
    try:
        fv = float(value)
    except (TypeError, ValueError) as ex:
        raise SettingsValidationError(f"{name} must be a number, got {value!r}") from ex
    if not 0 <= fv <= 100:
        raise SettingsValidationError(f"{name} must be 0..100, got {fv}")
    return fv


def _v_execution_cycle(name: str, value: Any) -> int:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "daily":
            return 0
        if normalized == "weekly":
            return 1
    try:
        iv = int(value)
    except (TypeError, ValueError) as ex:
        raise SettingsValidationError(
            f"{name} must be daily/weekly or 0/1, got {value!r}"
        ) from ex
    if iv not in (0, 1):
        raise SettingsValidationError(f"{name} must be 0 or 1, got {iv}")
    return iv


BATTERY_VALIDATORS = {
    "minimum_soc":            _v_soc,
    "charge_cap":             _v_soc,
    "charge_start_time":      _v_time,
    "charge_end_time":        _v_time,
    "discharge_start_time":   _v_time,
    "discharge_end_time":     _v_time,
    "grid_charging":          _v_bool,
    "discharge_time_control": _v_bool,
    "ups_reserve_enable":     _v_bool,
    "offgrid_soc_control":    _v_bool,
    "offgrid_wakeup_soc":     _v_cutoff_soc,
    "offgrid_cutoff_soc":     _v_cutoff_soc,
    "charge_power":           _v_battery_power,
    "discharge_power":        _v_battery_power,
    "execution_cycle_type":   _v_execution_cycle,
}

FEEDIN_VALIDATORS = {
    "enabled":    _v_bool,
    "cutoff_soc": _v_cutoff_soc,
}

FEEDIN_SLOT_VALIDATORS = {
    "start": _v_time,
    "end":   _v_time,
    "power": _v_feedin_power,
}

_WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7]


def _v_weeks(name: str, value: Any) -> list[int]:
    if value in (None, "", []):
        raise SettingsValidationError(f"{name} must contain at least one day")
    if isinstance(value, str):
        items = [part.strip() for part in value.split(",") if part.strip()]
    elif isinstance(value, (list, tuple, set)):
        items = list(value)
    else:
        raise SettingsValidationError(f"{name} must be a list of weekdays, got {value!r}")

    weeks: list[int] = []
    for item in items:
        try:
            day = int(item)
        except (TypeError, ValueError) as ex:
            raise SettingsValidationError(f"{name} contains invalid weekday {item!r}") from ex
        if day not in _WEEKDAY_ORDER:
            raise SettingsValidationError(f"{name} must use weekdays 1..7, got {day}")
        if day not in weeks:
            weeks.append(day)
    if not weeks:
        raise SettingsValidationError(f"{name} must contain at least one day")
    return sorted(weeks, key=_WEEKDAY_ORDER.index)


def _time_sort_key(value: str) -> tuple[int, int]:
    hour, minute = value.split(":", 1)
    return (int(hour), int(minute))


class SettingsManager:
    """Owns cache + pending diff + submit lifecycle for one config entry."""

    # Submit operation timeout — protects against an unresponsive API
    # holding the lock and blocking future refreshes/submits indefinitely.
    SUBMIT_TIMEOUT_SECONDS = 60

    # After a successful submit, skip fetching that batch on the next
    # refresh(es) for this long. The Byte-Watt API isn't read-after-write
    # consistent — without this window the UI can flick back to the
    # pre-submit value for one poll cycle.
    POST_SUBMIT_TRUST_SECONDS = 30

    def __init__(self, hass: HomeAssistant, client, entry_id: str) -> None:
        self._hass = hass
        self._client = client  # NeovoltClient
        self._entry_id = entry_id
        self._lock = asyncio.Lock()

        # Server cache
        self._battery_cache: Optional[CycleStrategy] = None
        self._feedin_cache: Optional[GridFeedInSettings] = None
        self._force_charge_status: Optional[bool] = None
        self._force_charge_limit: Optional[float] = None

        # Pending diff (cleared per-batch on successful submit)
        self._pending_battery: Dict[str, Any] = {}
        self._pending_feedin: Dict[str, Any] = {}
        self._pending_feedin_slots: Dict[int, Dict[str, Any]] = {}

        # Temporary policy overlays for "now" helpers.
        self._temporary_rows: Dict[tuple[str, str], Dict[str, Any]] = {}

        # Per-batch post-submit "trust local cache" timestamps
        self._battery_submitted_at: Optional[datetime] = None
        self._feedin_submitted_at: Optional[datetime] = None

    # ------------------------------------------------------------------
    # Pending-change dispatcher signal
    # ------------------------------------------------------------------

    def _notify_pending_changed(self) -> None:
        """Tell Submit/Discard buttons (and anyone else listening)
        that the pending dict shape just changed."""
        async_dispatcher_send(self._hass, signal_pending_changed(self._entry_id))

    # ------------------------------------------------------------------
    # Read — sync, lock-free
    # ------------------------------------------------------------------

    @property
    def battery_cache(self) -> Optional[CycleStrategy]:
        return self._battery_cache

    @property
    def feedin_cache(self) -> Optional[GridFeedInSettings]:
        return self._feedin_cache

    def has_pending(self) -> bool:
        return bool(
            self._pending_battery or self._pending_feedin or self._pending_feedin_slots
        )

    def pending_count(self) -> int:
        return (
            len(self._pending_battery)
            + len(self._pending_feedin)
            + sum(len(s) for s in self._pending_feedin_slots.values())
        )

    @property
    def current_settings_target_id(self) -> str:
        return getattr(self._client, "host_system_id", "") or ""

    @property
    def current_settings_target_sys_sn(self) -> str:
        return getattr(self._client, "host_sys_sn", "") or ""

    @property
    def force_charge_status(self) -> Optional[bool]:
        return self._force_charge_status

    @property
    def force_charge_limit(self) -> Optional[float]:
        return self._force_charge_limit

    def battery_slot_limit(self) -> int:
        if self._battery_cache and self._battery_cache.execute_cycle_type == 1:
            return BATTERY_WEEKLY_MAX_SLOTS
        return BATTERY_DAILY_MAX_SLOTS

    def battery_policy_summary(self) -> dict[str, Any]:
        strategy = self._battery_cache
        if strategy is None:
            return {}
        target_key = self._target_key()
        discharge_temp = self._temporary_rows.get(target_key + ("discharge",))
        return {
            "execution_cycle_type": strategy.execute_cycle_type,
            "execution_cycle_label": "Weekly" if strategy.execute_cycle_type == 1 else "Daily",
            "charge_slot_limit": self.battery_slot_limit(),
            "discharge_slot_limit": self.battery_slot_limit(),
            "charge_slots": [self._charge_slot_to_summary(slot) for slot in strategy.charge_slots],
            "discharge_slots": [self._discharge_slot_to_summary(slot) for slot in strategy.discharge_slots],
            "force_charge_active": bool(self._force_charge_status),
            "force_charge_limit": self._force_charge_limit,
            "offgrid_supported": bool(strategy.is_support_offgrid_soc_control),
            "offgrid_enabled": bool(strategy.loadcutout_en),
            "offgrid_wakeup_soc": strategy.wakeup_soc,
            "offgrid_cutoff_soc": strategy.cutoff_soc,
            "discharge_policy_enabled": (
                bool(discharge_temp["saved_enabled"])
                if discharge_temp and "saved_enabled" in discharge_temp
                else bool(strategy.ctr_dis_cycle)
            ),
            "temporary_discharge_now": target_key + ("discharge",) in self._temporary_rows,
        }

    def feedin_policy_summary(self) -> dict[str, Any]:
        settings = self._feedin_cache
        if settings is None:
            return {}
        target_key = self._target_key()
        feedin_temp = self._temporary_rows.get(target_key + ("feedin",))
        saved_enabled = (
            bool(feedin_temp["saved_enabled"])
            if feedin_temp and "saved_enabled" in feedin_temp
            else bool(settings.battery_en)
        )
        return {
            "slot_limit": FEEDIN_MAX_SLOTS,
            "enabled": saved_enabled,
            "runtime_enabled": bool(settings.battery_en),
            "cutoff_soc": settings.battery_feed_cutoff_soc,
            "slots": [self._feedin_slot_to_summary(slot) for slot in settings.slots],
            "temporary_feedin_now": target_key + ("feedin",) in self._temporary_rows,
        }

    def effective_battery(self, field: str, default: Any = None) -> Any:
        if field in self._pending_battery:
            return self._pending_battery[field]
        if field == "discharge_time_control":
            temp = self._temporary_rows.get(self._target_key() + ("discharge",))
            if temp and "saved_enabled" in temp:
                return bool(temp["saved_enabled"])
        return self._read_battery_from_cache(field, default)

    def effective_feedin(self, field: str, default: Any = None) -> Any:
        if field in self._pending_feedin:
            return self._pending_feedin[field]
        if self._feedin_cache is None:
            return default
        if field == "enabled":
            temp = self._temporary_rows.get(self._target_key() + ("feedin",))
            if temp and "saved_enabled" in temp:
                return bool(temp["saved_enabled"])
            return bool(self._feedin_cache.battery_en)
        if field == "cutoff_soc":
            return float(self._feedin_cache.battery_feed_cutoff_soc)
        return default

    def effective_feedin_slot(
        self, slot_index: int, field: str, default: Any = None
    ) -> Any:
        slot_pending = self._pending_feedin_slots.get(slot_index, {})
        if field in slot_pending:
            return slot_pending[field]
        if self._feedin_cache is None or slot_index >= len(self._feedin_cache.slots):
            return default
        slot = self._feedin_cache.slots[slot_index]
        if field == "start":
            return slot.start
        if field == "end":
            return slot.end
        if field == "power":
            return slot.feed_power
        return default

    def _target_key(self) -> tuple[str]:
        return (self.current_settings_target_id or "__all__",)

    @staticmethod
    def _charge_slot_to_summary(slot: ChargeSlot) -> dict[str, Any]:
        return {
            "sort": slot.sort,
            "start": slot.begin_time,
            "end": slot.end_time,
            "soc": slot.charge_limit,
            "power": slot.charge_power,
            "weeks": list(slot.weeks),
        }

    @staticmethod
    def _discharge_slot_to_summary(slot: DischargeSlot) -> dict[str, Any]:
        return {
            "sort": slot.sort,
            "start": slot.begin_time,
            "end": slot.end_time,
            "soc": slot.charge_limit,
            "power": slot.charge_power,
            "weeks": list(slot.weeks),
        }

    @staticmethod
    def _feedin_slot_to_summary(slot: GridFeedInSlot) -> dict[str, Any]:
        return {
            "sort": slot.sort,
            "start": slot.start,
            "end": slot.end,
            "power": slot.feed_power,
        }

    def feedin_slot_available(self, slot_index: int) -> bool:
        if slot_index in self._pending_feedin_slots:
            return True
        return (
            self._feedin_cache is not None
            and slot_index < len(self._feedin_cache.slots)
        )

    def _read_battery_from_cache(self, field: str, default: Any) -> Any:
        c = self._battery_cache
        if c is None:
            return default
        if field == "minimum_soc":
            return c.bat_use_cap
        if field == "charge_cap":
            return c.charge_slots[0].charge_limit if c.charge_slots else default
        if field == "charge_start_time":
            return c.charge_slots[0].begin_time if c.charge_slots else default
        if field == "charge_end_time":
            return c.charge_slots[0].end_time if c.charge_slots else default
        if field == "discharge_start_time":
            return c.discharge_slots[0].begin_time if c.discharge_slots else default
        if field == "discharge_end_time":
            return c.discharge_slots[0].end_time if c.discharge_slots else default
        if field == "grid_charging":
            return bool(c.grid_charge_cycle)
        if field == "discharge_time_control":
            return bool(c.ctr_dis_cycle)
        if field == "ups_reserve_enable":
            return bool(c.ups_reserve_enable)
        if field == "offgrid_soc_control":
            return bool(c.loadcutout_en)
        if field == "offgrid_wakeup_soc":
            return c.wakeup_soc
        if field == "offgrid_cutoff_soc":
            return c.cutoff_soc
        if field == "execution_cycle_type":
            return c.execute_cycle_type
        if field == "charge_power":
            return c.charge_slots[0].charge_power if c.charge_slots else default
        if field == "discharge_power":
            return c.discharge_slots[0].charge_power if c.discharge_slots else default
        return default

    # ------------------------------------------------------------------
    # Stage — validates and stores; no API call; lock-free; safe to call
    # any time including during a submit-in-flight (see class docstring)
    # ------------------------------------------------------------------

    def stage_battery(self, field: str, value: Any) -> None:
        if field not in BATTERY_VALIDATORS:
            raise SettingsValidationError(f"Unknown battery field: {field}")
        validated = BATTERY_VALIDATORS[field](field, value)
        self._pending_battery[field] = validated
        _LOGGER.debug("Staged battery.%s = %r", field, validated)
        self._notify_pending_changed()

    def stage_feedin(self, field: str, value: Any) -> None:
        if field not in FEEDIN_VALIDATORS:
            raise SettingsValidationError(f"Unknown feed-in field: {field}")
        validated = FEEDIN_VALIDATORS[field](field, value)
        self._pending_feedin[field] = validated
        _LOGGER.debug("Staged feedin.%s = %r", field, validated)
        self._notify_pending_changed()

    def stage_feedin_slot(self, slot_index: int, field: str, value: Any) -> None:
        if field not in FEEDIN_SLOT_VALIDATORS:
            raise SettingsValidationError(f"Unknown feed-in slot field: {field}")
        validated = FEEDIN_SLOT_VALIDATORS[field](field, value)
        self._pending_feedin_slots.setdefault(slot_index, {})[field] = validated
        _LOGGER.debug("Staged feedin.slots[%d].%s = %r", slot_index, field, validated)
        self._notify_pending_changed()

    def discard(self) -> int:
        """Drop all pending changes. Returns the count discarded.

        If a submit is in flight, only changes NOT already snapshotted
        for that submit are dropped — the in-flight API call cannot be
        recalled. New changes staged after a discard land normally.
        """
        count = self.pending_count()
        self._pending_battery.clear()
        self._pending_feedin.clear()
        self._pending_feedin_slots.clear()
        self._notify_pending_changed()
        return count

    async def async_select_settings_target(self, scope: ByteWattScope) -> int:
        """Switch the active settings target and refresh caches for it.

        Returns the number of pending changes discarded during the switch.
        """
        discarded = self.discard()
        async with self._lock:
            self._client.host_system_id = scope.effective_system_id
            self._client.host_sys_sn = scope.settings_sys_sn or scope.sys_sn
            self._battery_cache = None
            self._feedin_cache = None
            self._battery_submitted_at = None
            self._feedin_submitted_at = None
            await self._refresh_locked()
        return discarded

    # ------------------------------------------------------------------
    # Refresh — pulls latest server state into cache, never touches pending
    # ------------------------------------------------------------------

    async def refresh(self) -> None:
        async with self._lock:
            await self._refresh_locked()

    async def _refresh_locked(self) -> None:
        now = dt_util.utcnow()

        if self._battery_submitted_at and (
            now - self._battery_submitted_at < timedelta(seconds=self.POST_SUBMIT_TRUST_SECONDS)
        ):
            _LOGGER.debug(
                "Skipping battery refresh — trusting local cache for %.0fs after submit",
                self.POST_SUBMIT_TRUST_SECONDS,
            )
        else:
            try:
                battery = await BatterySettingsAPI(self._client).fetch_current_settings()
                if battery is not None:
                    self._battery_cache = battery
                force_charge_api = ForceChargeAPI(self._client)
                self._force_charge_status = await force_charge_api.fetch_status()
                self._force_charge_limit = await force_charge_api.fetch_limit()
            except Exception as ex:  # noqa: BLE001 — surface in logs, never crash poll
                _LOGGER.warning("Battery settings refresh failed: %s", ex)

        if self._feedin_submitted_at and (
            now - self._feedin_submitted_at < timedelta(seconds=self.POST_SUBMIT_TRUST_SECONDS)
        ):
            _LOGGER.debug(
                "Skipping feed-in refresh — trusting local cache for %.0fs after submit",
                self.POST_SUBMIT_TRUST_SECONDS,
            )
        else:
            try:
                feedin = await GridFeedInSettingsAPI(self._client).fetch_current_settings()
                if feedin is not None:
                    self._feedin_cache = feedin
            except Exception as ex:  # noqa: BLE001
                _LOGGER.warning("Grid feed-in settings refresh failed: %s", ex)

    # ------------------------------------------------------------------
    # Submit — single transactional push; per-batch atomicity
    # ------------------------------------------------------------------

    async def submit_battery_one_shot(self, fields: Dict[str, Any]) -> SubmitResult:
        """Validate, build a payload, and PUT — without touching pending.

        Service handlers use this so a service call doesn't accidentally
        commit the user's UI-staged drafts. fields is a dict of logical
        battery field names to values (same keys as stage_battery).
        """
        result = SubmitResult()
        snapshot: Dict[str, Any] = {}
        try:
            for field, value in fields.items():
                if value is None:
                    continue
                if field not in BATTERY_VALIDATORS:
                    raise SettingsValidationError(f"Unknown battery field: {field}")
                snapshot[field] = BATTERY_VALIDATORS[field](field, value)
        except SettingsValidationError as ex:
            result.battery_attempted = True
            result.battery_error = str(ex)
            return result

        if not snapshot:
            return result

        async with self._lock:
            await self._submit_battery(snapshot, result)
            # _submit_battery updates _battery_cache on success — UI entities
            # will read the new value via effective_battery.
            self._notify_pending_changed()
        return result

    async def submit_feedin_one_shot(
        self,
        top: Dict[str, Any] | None = None,
        slots: Dict[int, Dict[str, Any]] | None = None,
    ) -> SubmitResult:
        """Validate + POST grid feed-in without touching pending."""
        result = SubmitResult()
        top_snapshot: Dict[str, Any] = {}
        slots_snapshot: Dict[int, Dict[str, Any]] = {}
        try:
            for field, value in (top or {}).items():
                if value is None:
                    continue
                if field not in FEEDIN_VALIDATORS:
                    raise SettingsValidationError(f"Unknown feed-in field: {field}")
                top_snapshot[field] = FEEDIN_VALIDATORS[field](field, value)
            for slot_idx, slot_fields in (slots or {}).items():
                slot_clean: Dict[str, Any] = {}
                for field, value in slot_fields.items():
                    if value is None:
                        continue
                    if field not in FEEDIN_SLOT_VALIDATORS:
                        raise SettingsValidationError(f"Unknown feed-in slot field: {field}")
                    slot_clean[field] = FEEDIN_SLOT_VALIDATORS[field](field, value)
                if slot_clean:
                    slots_snapshot[slot_idx] = slot_clean
        except SettingsValidationError as ex:
            result.feedin_attempted = True
            result.feedin_error = str(ex)
            return result

        if not (top_snapshot or slots_snapshot):
            return result

        async with self._lock:
            await self._submit_feedin(top_snapshot, slots_snapshot, result)
            self._notify_pending_changed()
        return result

    async def force_charge_start(self, limit_soc: int) -> None:
        validated = _v_soc("force_charge_limit", limit_soc)
        async with self._lock:
            api = ForceChargeAPI(self._client)
            ok = await api.start(validated)
            if not ok:
                raise SettingsValidationError("Force charge start failed")
            self._force_charge_status = True
            self._force_charge_limit = float(validated)

    async def force_charge_stop(self) -> None:
        async with self._lock:
            api = ForceChargeAPI(self._client)
            ok = await api.stop()
            if not ok:
                raise SettingsValidationError("Force charge stop failed")
            self._force_charge_status = False

    async def update_battery_slot(
        self,
        policy_kind: str,
        slot_number: int,
        *,
        start: str | None = None,
        end: str | None = None,
        soc: int | None = None,
        power: int | None = None,
        weeks: list[int] | None = None,
    ) -> None:
        kind = self._validate_policy_kind(policy_kind)
        slot_index = self._validate_slot_index(slot_number)
        async with self._lock:
            if self._battery_cache is None:
                raise SettingsValidationError("Battery settings are not loaded yet")
            merged = copy.deepcopy(self._battery_cache)
            slots = self._slots_for_policy(merged, kind)
            self._ensure_slot(slots, slot_index, kind)
            slot = slots[slot_index]
            if start is not None:
                value = _v_time("start_time", start)
                if kind == "charge":
                    slot.begin_time = value
                else:
                    slot.begin_time = value
            if end is not None:
                value = _v_time("end_time", end)
                slot.end_time = value
            if soc is not None:
                slot.charge_limit = float(_v_soc("soc", soc))
            if power is not None:
                slot.charge_power = int(_v_battery_power("power", power))
            if weeks is not None:
                slot.weeks = _v_weeks("weeks", weeks)
            self._normalize_and_validate_battery_slots(slots, kind, merged.execute_cycle_type)
            result = SubmitResult()
            await self._submit_battery_with_merged(merged, result)
            if not result.battery_ok:
                raise SettingsValidationError(result.battery_error or "Battery slot update failed")

    async def delete_battery_slot(self, policy_kind: str, slot_number: int) -> None:
        kind = self._validate_policy_kind(policy_kind)
        slot_index = self._validate_slot_index(slot_number)
        async with self._lock:
            if self._battery_cache is None:
                raise SettingsValidationError("Battery settings are not loaded yet")
            merged = copy.deepcopy(self._battery_cache)
            slots = self._slots_for_policy(merged, kind)
            if slot_index >= len(slots):
                raise SettingsValidationError(f"{kind.title()} slot {slot_number} does not exist")
            slots.pop(slot_index)
            self._normalize_and_validate_battery_slots(slots, kind, merged.execute_cycle_type)
            result = SubmitResult()
            await self._submit_battery_with_merged(merged, result)
            if not result.battery_ok:
                raise SettingsValidationError(result.battery_error or "Battery slot delete failed")

    async def update_feedin_slot(
        self,
        slot_number: int,
        *,
        start: str | None = None,
        end: str | None = None,
        power: int | None = None,
    ) -> None:
        slot_index = self._validate_slot_index(slot_number)
        async with self._lock:
            if self._feedin_cache is None:
                raise SettingsValidationError("Feed-in settings are not loaded yet")
            merged = copy.deepcopy(self._feedin_cache)
            self._ensure_feedin_slot(merged.slots, slot_index)
            slot = merged.slots[slot_index]
            if start is not None:
                slot.start = _v_time("start_time", start)
            if end is not None:
                slot.end = _v_time("end_time", end)
            if power is not None:
                slot.feed_power = int(_v_feedin_power("power", power))
            self._normalize_and_validate_feedin_slots(merged.slots)
            result = SubmitResult()
            await self._submit_feedin_with_merged(merged, result)
            if not result.feedin_ok:
                raise SettingsValidationError(result.feedin_error or "Feed-in slot update failed")

    async def delete_feedin_slot(self, slot_number: int) -> None:
        slot_index = self._validate_slot_index(slot_number)
        async with self._lock:
            if self._feedin_cache is None:
                raise SettingsValidationError("Feed-in settings are not loaded yet")
            merged = copy.deepcopy(self._feedin_cache)
            if slot_index >= len(merged.slots):
                raise SettingsValidationError(f"Feed-in slot {slot_number} does not exist")
            merged.slots.pop(slot_index)
            self._normalize_and_validate_feedin_slots(merged.slots)
            result = SubmitResult()
            await self._submit_feedin_with_merged(merged, result)
            if not result.feedin_ok:
                raise SettingsValidationError(result.feedin_error or "Feed-in slot delete failed")

    async def start_discharge_now(
        self, *, duration_minutes: int, soc: int, power: int
    ) -> None:
        async with self._lock:
            if self._battery_cache is None:
                raise SettingsValidationError("Battery settings are not loaded yet")
            saved_enabled = bool(self._battery_cache.ctr_dis_cycle)
            merged = copy.deepcopy(self._battery_cache)
            slots = self._slots_for_policy(merged, "discharge")
            if len(slots) >= self._slot_limit_for_cycle(merged.execute_cycle_type):
                raise SettingsValidationError("All discharge slots are already in use")
            temp_slot = DischargeSlot(
                begin_time=self._now_hhmm(),
                end_time=self._future_hhmm(duration_minutes),
                charge_limit=float(_v_soc("soc", soc)),
                charge_power=int(_v_battery_power("power", power)),
                weeks=[1, 2, 3, 4, 5, 6, 7],
            )
            slots.append(temp_slot)
            merged.ctr_dis_cycle = 1
            self._normalize_and_validate_battery_slots(slots, "discharge", merged.execute_cycle_type)
            result = SubmitResult()
            await self._submit_battery_with_merged(merged, result)
            if not result.battery_ok:
                raise SettingsValidationError(result.battery_error or "Discharge now failed")
            self._temporary_rows[self._target_key() + ("discharge",)] = {
                "start": temp_slot.begin_time,
                "end": temp_slot.end_time,
                "soc": temp_slot.charge_limit,
                "power": temp_slot.charge_power,
                "saved_enabled": saved_enabled,
            }

    async def stop_discharge_now(self) -> None:
        await self._stop_temporary_battery_row("discharge")

    async def start_feedin_now(
        self, *, duration_minutes: int, power: int
    ) -> None:
        async with self._lock:
            if self._feedin_cache is None:
                raise SettingsValidationError("Feed-in settings are not loaded yet")
            saved_enabled = bool(self._feedin_cache.battery_en)
            merged = copy.deepcopy(self._feedin_cache)
            if len(merged.slots) >= FEEDIN_MAX_SLOTS:
                raise SettingsValidationError("All feed-in slots are already in use")
            temp_slot = GridFeedInSlot(
                sys_sn=self.current_settings_target_sys_sn,
                start=self._now_hhmm(),
                end=self._future_hhmm(duration_minutes),
                feed_power=int(_v_feedin_power("power", power)),
            )
            merged.slots.append(temp_slot)
            merged.battery_en = 1
            self._normalize_and_validate_feedin_slots(merged.slots)
            result = SubmitResult()
            await self._submit_feedin_with_merged(merged, result)
            if not result.feedin_ok:
                raise SettingsValidationError(result.feedin_error or "Feed-in now failed")
            self._temporary_rows[self._target_key() + ("feedin",)] = {
                "start": temp_slot.start,
                "end": temp_slot.end,
                "power": temp_slot.feed_power,
                "saved_enabled": saved_enabled,
            }

    async def stop_feedin_now(self) -> None:
        async with self._lock:
            temp = self._temporary_rows.get(self._target_key() + ("feedin",))
            if not temp:
                return
            if self._feedin_cache is None:
                raise SettingsValidationError("Feed-in settings are not loaded yet")
            merged = copy.deepcopy(self._feedin_cache)
            merged.slots = [
                slot for slot in merged.slots
                if not (
                    slot.start == temp["start"]
                    and slot.end == temp["end"]
                    and int(slot.feed_power) == int(temp["power"])
                )
            ]
            merged.battery_en = 1 if temp.get("saved_enabled") else 0
            self._normalize_and_validate_feedin_slots(merged.slots)
            result = SubmitResult()
            await self._submit_feedin_with_merged(merged, result)
            if not result.feedin_ok:
                raise SettingsValidationError(result.feedin_error or "Stop feed-in now failed")
            self._temporary_rows.pop(self._target_key() + ("feedin",), None)

    async def submit(self) -> SubmitResult:
        """Push pending changes to the API.

        Snapshots pending into locals, hands them to `_submit_locked`,
        and unconditionally restores any unsubmitted ones on the way out
        (timeout, cancellation, unexpected exception) so the user never
        loses staged values.
        """
        result = SubmitResult()
        # Snapshot OUTSIDE the lock so the timeout/exception handler can
        # see them and restore on its way out.
        snapshot_battery = self._pending_battery
        snapshot_feedin = self._pending_feedin
        snapshot_feedin_slots = self._pending_feedin_slots
        self._pending_battery = {}
        self._pending_feedin = {}
        self._pending_feedin_slots = {}
        self._notify_pending_changed()

        try:
            async with asyncio.timeout(self.SUBMIT_TIMEOUT_SECONDS):
                async with self._lock:
                    await self._submit_battery(snapshot_battery, result)
                    await self._submit_feedin(
                        snapshot_feedin, snapshot_feedin_slots, result
                    )
        except asyncio.TimeoutError:
            _LOGGER.error("Submit timed out after %ds", self.SUBMIT_TIMEOUT_SECONDS)
            if snapshot_battery and not result.battery_ok:
                result.battery_attempted = True
                result.battery_error = result.battery_error or "submit timed out"
            if (snapshot_feedin or snapshot_feedin_slots) and not result.feedin_ok:
                result.feedin_attempted = True
                result.feedin_error = result.feedin_error or "submit timed out"
        except asyncio.CancelledError:
            # HA is shutting down, or the task was cancelled — preserve pending
            # and re-raise so the cancellation propagates correctly.
            self._restore_battery_pending(snapshot_battery)
            self._restore_feedin_pending(snapshot_feedin, snapshot_feedin_slots)
            self._notify_pending_changed()
            raise
        except Exception as ex:  # noqa: BLE001
            _LOGGER.exception("Unexpected error during submit: %s", ex)
            if snapshot_battery and not result.battery_ok:
                result.battery_attempted = True
                result.battery_error = result.battery_error or f"unexpected: {ex}"
            if (snapshot_feedin or snapshot_feedin_slots) and not result.feedin_ok:
                result.feedin_attempted = True
                result.feedin_error = result.feedin_error or f"unexpected: {ex}"

        # Restore anything that didn't make it to the inverter. On full
        # success this is a no-op (the per-batch _submit_* paths cleared
        # their locals via the "ok" branch). On partial / total failure,
        # the snapshot is merged back via setdefault so any newer stage_*
        # made during submit wins on conflict.
        if not result.battery_ok and snapshot_battery:
            self._restore_battery_pending(snapshot_battery)
        if not result.feedin_ok and (snapshot_feedin or snapshot_feedin_slots):
            self._restore_feedin_pending(snapshot_feedin, snapshot_feedin_slots)
        self._notify_pending_changed()
        return result

    # Submit retry policy.
    #
    # The manager owns the retry loop and does a full re-fetch + rebuild +
    # single write on EACH attempt. This is deliberate: the failure mode we
    # care about (a stale raw_data field such as poinv getting the PUT
    # rejected) is deterministic — re-sending identical bytes, as a
    # transport-level retry does, gets the identical rejection. Rebuilding
    # against freshly-fetched server state on each attempt is what actually
    # lets the submit self-heal. Transient failures (9007, rate-limit, a
    # blip) are also covered by the same loop + backoff.
    #
    # The transport calls are therefore made single-attempt (max_retries=1,
    # which still performs the 6069 re-login) so retries don't stack into
    # this loop and compound the time spent under the submit lock + timeout.
    SUBMIT_RETRIES = 3
    SUBMIT_RETRY_DELAY = 4.0  # seconds between attempts
    _SINGLE_ATTEMPT = 1

    async def _submit_battery(
        self, snapshot: Dict[str, Any], result: SubmitResult
    ) -> None:
        if not snapshot:
            return
        result.battery_attempted = True
        api = BatterySettingsAPI(self._client)

        for attempt in range(1, self.SUBMIT_RETRIES + 1):
            # Re-fetch + rebuild on every attempt so a stale-data rejection
            # can self-heal rather than re-sending the same rejected payload.
            fresh = await api.fetch_current_settings(max_retries=self._SINGLE_ATTEMPT)
            if fresh is not None:
                self._battery_cache = fresh
            elif self._battery_cache is None:
                result.battery_error = "could not fetch current battery settings"
                _LOGGER.warning(
                    "Battery submit attempt %d/%d: no settings to build against (entry=%s)",
                    attempt, self.SUBMIT_RETRIES, self._entry_id,
                )
                if attempt < self.SUBMIT_RETRIES:
                    await asyncio.sleep(self.SUBMIT_RETRY_DELAY)
                continue

            try:
                merged = self._build_battery_payload(snapshot)
            except SettingsValidationError as ex:
                # Deterministic build error (e.g. no slot defined) — retrying
                # can't help, so bail immediately.
                _LOGGER.error("Cannot build battery payload: %s", ex)
                result.battery_error = str(ex)
                return

            if await api.put(merged, max_retries=self._SINGLE_ATTEMPT):
                self._battery_cache = merged
                self._battery_submitted_at = dt_util.utcnow()
                result.battery_ok = True
                _LOGGER.info(
                    "Battery settings submitted (entry=%s, host=%s, attempt=%d/%d)",
                    self._entry_id,
                    getattr(self._client, "host_system_id", "") or "default",
                    attempt, self.SUBMIT_RETRIES,
                )
                return

            result.battery_error = f"API call failed on attempt {attempt}/{self.SUBMIT_RETRIES}"
            _LOGGER.warning(
                "Battery submit attempt %d/%d failed (entry=%s)%s",
                attempt, self.SUBMIT_RETRIES, self._entry_id,
                f"; retrying in {self.SUBMIT_RETRY_DELAY:.0f}s"
                if attempt < self.SUBMIT_RETRIES else "; no more retries",
            )
            if attempt < self.SUBMIT_RETRIES:
                await asyncio.sleep(self.SUBMIT_RETRY_DELAY)

        _LOGGER.error(
            "Battery submit failed after %d attempt(s); pending changes preserved",
            self.SUBMIT_RETRIES,
        )

    async def _submit_feedin(
        self,
        snapshot_top: Dict[str, Any],
        snapshot_slots: Dict[int, Dict[str, Any]],
        result: SubmitResult,
    ) -> None:
        if not (snapshot_top or snapshot_slots):
            return
        result.feedin_attempted = True
        api = GridFeedInSettingsAPI(self._client)

        for attempt in range(1, self.SUBMIT_RETRIES + 1):
            # Re-fetch + rebuild on every attempt (see _submit_battery).
            fresh = await api.fetch_current_settings(max_retries=self._SINGLE_ATTEMPT)
            if fresh is not None:
                self._feedin_cache = fresh
            elif self._feedin_cache is None:
                result.feedin_error = "could not fetch current feed-in settings"
                _LOGGER.warning(
                    "Feed-in submit attempt %d/%d: no settings to build against (entry=%s)",
                    attempt, self.SUBMIT_RETRIES, self._entry_id,
                )
                if attempt < self.SUBMIT_RETRIES:
                    await asyncio.sleep(self.SUBMIT_RETRY_DELAY)
                continue

            try:
                merged = self._build_feedin_payload(snapshot_top, snapshot_slots)
            except SettingsValidationError as ex:
                _LOGGER.error("Cannot build feed-in payload: %s", ex)
                result.feedin_error = str(ex)
                return

            if await api.post(merged, max_retries=self._SINGLE_ATTEMPT):
                self._feedin_cache = merged
                self._feedin_submitted_at = dt_util.utcnow()
                result.feedin_ok = True
                _LOGGER.info(
                    "Grid feed-in settings submitted (entry=%s, host=%s, attempt=%d/%d)",
                    self._entry_id,
                    getattr(self._client, "host_system_id", "") or "default",
                    attempt, self.SUBMIT_RETRIES,
                )
                return

            result.feedin_error = f"API call failed on attempt {attempt}/{self.SUBMIT_RETRIES}"
            _LOGGER.warning(
                "Feed-in submit attempt %d/%d failed (entry=%s)%s",
                attempt, self.SUBMIT_RETRIES, self._entry_id,
                f"; retrying in {self.SUBMIT_RETRY_DELAY:.0f}s"
                if attempt < self.SUBMIT_RETRIES else "; no more retries",
            )
            if attempt < self.SUBMIT_RETRIES:
                await asyncio.sleep(self.SUBMIT_RETRY_DELAY)

        _LOGGER.error(
            "Feed-in submit failed after %d attempt(s); pending changes preserved",
            self.SUBMIT_RETRIES,
        )

    # Restore helpers — `setdefault` ensures fresh stage_* calls made during
    # the submit win over the restored snapshot value on conflict (later
    # edit always beats earlier).
    def _restore_battery_pending(self, snapshot: Dict[str, Any]) -> None:
        for k, v in snapshot.items():
            self._pending_battery.setdefault(k, v)

    def _restore_feedin_pending(
        self,
        snapshot_top: Dict[str, Any],
        snapshot_slots: Dict[int, Dict[str, Any]],
    ) -> None:
        for k, v in snapshot_top.items():
            self._pending_feedin.setdefault(k, v)
        for slot_index, slot_kwargs in snapshot_slots.items():
            target = self._pending_feedin_slots.setdefault(slot_index, {})
            for k, v in slot_kwargs.items():
                target.setdefault(k, v)

    # ------------------------------------------------------------------
    # Payload builders — clone cache and overlay the snapshot
    # ------------------------------------------------------------------

    def _build_battery_payload(self, pending: Dict[str, Any]) -> CycleStrategy:
        if self._battery_cache is None:
            raise SettingsValidationError(
                "No battery settings cache yet — wait for the first successful poll "
                "before submitting"
            )
        merged = copy.deepcopy(self._battery_cache)

        if "minimum_soc" in pending:
            merged.bat_use_cap = float(pending["minimum_soc"])
        if "charge_cap" in pending:
            if not merged.charge_slots:
                raise SettingsValidationError(
                    "Cannot set charge_cap: no charge slot defined on the inverter"
                )
            merged.charge_slots[0].charge_limit = float(pending["charge_cap"])
        if "grid_charging" in pending:
            merged.grid_charge_cycle = 1 if pending["grid_charging"] else 0
        if "discharge_time_control" in pending:
            merged.ctr_dis_cycle = 1 if pending["discharge_time_control"] else 0
        if "ups_reserve_enable" in pending:
            merged.ups_reserve_enable = 1 if pending["ups_reserve_enable"] else 0
        if "offgrid_soc_control" in pending:
            merged.loadcutout_en = 1 if pending["offgrid_soc_control"] else 0
        if "offgrid_wakeup_soc" in pending:
            merged.wakeup_soc = int(pending["offgrid_wakeup_soc"])
        if "offgrid_cutoff_soc" in pending:
            merged.cutoff_soc = int(pending["offgrid_cutoff_soc"])
        if "execution_cycle_type" in pending:
            merged.execute_cycle_type = int(pending["execution_cycle_type"])

        for field_name, slot_attr, slot_list_attr in (
            ("charge_start_time",    "begin_time", "charge_slots"),
            ("charge_end_time",      "end_time",   "charge_slots"),
            ("discharge_start_time", "begin_time", "discharge_slots"),
            ("discharge_end_time",   "end_time",   "discharge_slots"),
        ):
            if field_name in pending:
                slots = getattr(merged, slot_list_attr)
                if not slots:
                    raise SettingsValidationError(
                        f"Cannot set {field_name}: no slot defined on the inverter"
                    )
                setattr(slots[0], slot_attr, pending[field_name])

        if "charge_power" in pending:
            if not merged.charge_slots:
                raise SettingsValidationError("Cannot set charge_power: no charge slot")
            merged.charge_slots[0].charge_power = int(pending["charge_power"])
        if "discharge_power" in pending:
            if not merged.discharge_slots:
                raise SettingsValidationError("Cannot set discharge_power: no discharge slot")
            merged.discharge_slots[0].charge_power = int(pending["discharge_power"])

        self._normalize_slot_powers_to_poinv(merged)
        return merged

    async def _submit_battery_with_merged(
        self, merged: CycleStrategy, result: SubmitResult
    ) -> None:
        result.battery_attempted = True
        api = BatterySettingsAPI(self._client)
        self._normalize_slot_powers_to_poinv(merged)
        if await api.put(merged, max_retries=self._SINGLE_ATTEMPT):
            self._battery_cache = merged
            self._battery_submitted_at = dt_util.utcnow()
            result.battery_ok = True
            return
        result.battery_error = "API call failed"

    async def _submit_feedin_with_merged(
        self, merged: GridFeedInSettings, result: SubmitResult
    ) -> None:
        result.feedin_attempted = True
        api = GridFeedInSettingsAPI(self._client)
        if await api.post(merged, max_retries=self._SINGLE_ATTEMPT):
            self._feedin_cache = merged
            self._feedin_submitted_at = dt_util.utcnow()
            result.feedin_ok = True
            return
        result.feedin_error = "API call failed"

    @staticmethod
    def _validate_policy_kind(policy_kind: str) -> str:
        kind = (policy_kind or "").strip().lower()
        if kind not in {"charge", "discharge"}:
            raise SettingsValidationError(f"Unknown policy_kind {policy_kind!r}")
        return kind

    @staticmethod
    def _validate_slot_index(slot_number: int) -> int:
        try:
            slot = int(slot_number)
        except (TypeError, ValueError) as ex:
            raise SettingsValidationError(f"Invalid slot number {slot_number!r}") from ex
        if slot < 1:
            raise SettingsValidationError("Slot number must be 1 or higher")
        return slot - 1

    @staticmethod
    def _slot_limit_for_cycle(execute_cycle_type: int) -> int:
        return BATTERY_WEEKLY_MAX_SLOTS if execute_cycle_type == 1 else BATTERY_DAILY_MAX_SLOTS

    @staticmethod
    def _now_hhmm() -> str:
        now = dt_util.now()
        return now.strftime("%H:%M")

    @staticmethod
    def _future_hhmm(duration_minutes: int) -> str:
        minutes = max(1, int(duration_minutes))
        now = dt_util.now()
        future = now + timedelta(minutes=minutes)
        if future.date() != now.date():
            return "23:59"
        return future.strftime("%H:%M")

    @staticmethod
    def _slot_factory(kind: str) -> ChargeSlot | DischargeSlot:
        if kind == "charge":
            return ChargeSlot()
        return DischargeSlot()

    def _slots_for_policy(
        self, strategy: CycleStrategy, kind: str
    ) -> list[ChargeSlot] | list[DischargeSlot]:
        return strategy.charge_slots if kind == "charge" else strategy.discharge_slots

    def _ensure_slot(
        self,
        slots: list[ChargeSlot] | list[DischargeSlot],
        slot_index: int,
        kind: str,
    ) -> None:
        max_slots = self._slot_limit_for_cycle(self._battery_cache.execute_cycle_type if self._battery_cache else 0)
        if slot_index >= max_slots:
            raise SettingsValidationError(f"No free {kind} slot at position {slot_index + 1}")
        while len(slots) <= slot_index:
            slots.append(self._slot_factory(kind))

    @staticmethod
    def _normalize_and_validate_battery_slots(
        slots: list[ChargeSlot] | list[DischargeSlot],
        kind: str,
        execute_cycle_type: int,
    ) -> None:
        max_slots = BATTERY_WEEKLY_MAX_SLOTS if execute_cycle_type == 1 else BATTERY_DAILY_MAX_SLOTS
        if len(slots) > max_slots:
            raise SettingsValidationError(f"{kind.title()} supports at most {max_slots} rows")
        ordered = sorted(slots, key=lambda item: _time_sort_key(item.begin_time))
        for index, slot in enumerate(ordered, start=1):
            if _time_sort_key(slot.begin_time) >= _time_sort_key(slot.end_time):
                raise SettingsValidationError(f"{kind.title()} rows must end after they start")
            slot.sort = index
            if execute_cycle_type == 0:
                slot.weeks = [7, 1, 2, 3, 4, 5, 6]
            else:
                slot.weeks = _v_weeks("weeks", slot.weeks)
        for index, left in enumerate(ordered):
            for right in ordered[index + 1 :]:
                overlaps = (
                    _time_sort_key(left.begin_time) < _time_sort_key(right.end_time)
                    and _time_sort_key(right.begin_time) < _time_sort_key(left.end_time)
                )
                if not overlaps:
                    continue
                if execute_cycle_type == 0 or set(left.weeks).intersection(right.weeks):
                    raise SettingsValidationError(f"{kind.title()} rows cannot overlap")
        slots[:] = ordered

    def _normalize_and_validate_feedin_slots(self, slots: list[GridFeedInSlot]) -> None:
        if len(slots) > FEEDIN_MAX_SLOTS:
            raise SettingsValidationError(f"Feed-in supports at most {FEEDIN_MAX_SLOTS} rows")
        previous_end: str | None = None
        ordered = sorted(slots, key=lambda item: _time_sort_key(item.start))
        for index, slot in enumerate(ordered, start=1):
            if _time_sort_key(slot.start) >= _time_sort_key(slot.end):
                raise SettingsValidationError("Feed-in rows must end after they start")
            if previous_end and _time_sort_key(slot.start) < _time_sort_key(previous_end):
                raise SettingsValidationError("Feed-in rows cannot overlap")
            slot.sort = index
            if not slot.sys_sn:
                slot.sys_sn = self.current_settings_target_sys_sn
            previous_end = slot.end
        slots[:] = ordered

    async def _stop_temporary_battery_row(self, kind: str) -> None:
        async with self._lock:
            temp = self._temporary_rows.get(self._target_key() + (kind,))
            if not temp:
                return
            if self._battery_cache is None:
                raise SettingsValidationError("Battery settings are not loaded yet")
            merged = copy.deepcopy(self._battery_cache)
            slots = self._slots_for_policy(merged, kind)
            filtered = [
                slot for slot in slots
                if not (
                    slot.begin_time == temp["start"]
                    and slot.end_time == temp["end"]
                    and int(slot.charge_power) == int(temp["power"])
                    and int(slot.charge_limit) == int(temp["soc"])
                )
            ]
            slots[:] = filtered
            if kind == "discharge":
                merged.ctr_dis_cycle = 1 if temp.get("saved_enabled") else 0
            self._normalize_and_validate_battery_slots(slots, kind, merged.execute_cycle_type)
            result = SubmitResult()
            await self._submit_battery_with_merged(merged, result)
            if not result.battery_ok:
                raise SettingsValidationError(result.battery_error or f"Stop {kind} now failed")
            self._temporary_rows.pop(self._target_key() + (kind,), None)

    @staticmethod
    def _normalize_slot_powers_to_poinv(merged: CycleStrategy) -> None:
        """Keep slot powers within the payload's effective rated-power ceiling.

        HAR captures from parallel SPB5K systems show the server validating
        the *entire* cycle-strategy payload against ``poinv``. Once the
        backend decides the effective ceiling is 5000 W, leaving an unrelated
        slot at 10000 W can cause even a simple SOC or enable-flag edit to be
        rejected with "Power setting must not exceed rated power."

        Clamp both charge and discharge slot powers to the current payload
        ceiling before submit so stale slot values do not poison otherwise
        valid writes.
        """
        try:
            ceiling = int(merged.poinv or 0)
        except (TypeError, ValueError):
            return
        if ceiling <= 0:
            return

        for slot in merged.charge_slots:
            slot.charge_power = min(int(slot.charge_power), ceiling)
        for slot in merged.discharge_slots:
            slot.charge_power = min(int(slot.charge_power), ceiling)

    def _build_feedin_payload(
        self,
        pending_top: Dict[str, Any],
        pending_slots: Dict[int, Dict[str, Any]],
    ) -> GridFeedInSettings:
        if self._feedin_cache is None:
            raise SettingsValidationError(
                "No grid feed-in cache yet — wait for the first successful poll "
                "before submitting"
            )
        merged = copy.deepcopy(self._feedin_cache)

        if "enabled" in pending_top:
            merged.battery_en = 1 if pending_top["enabled"] else 0
        if "cutoff_soc" in pending_top:
            merged.battery_feed_cutoff_soc = float(pending_top["cutoff_soc"])

        for slot_index, slot_pending in pending_slots.items():
            while len(merged.slots) <= slot_index:
                merged.slots.append(GridFeedInSlot(sort=len(merged.slots) + 1))
            slot = merged.slots[slot_index]
            if "start" in slot_pending:
                slot.start = slot_pending["start"]
            if "end" in slot_pending:
                slot.end = slot_pending["end"]
            if "power" in slot_pending:
                slot.feed_power = int(slot_pending["power"])

        return merged
