"""The Byte-Watt integration."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import voluptuous as vol

from homeassistant.components.persistent_notification import (
    async_create as notify_create,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_SCAN_INTERVAL
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers import entity_registry as er

from .bytewatt_client import ByteWattClient
from .coordinator import ByteWattDataUpdateCoordinator
from .settings_manager import SettingsManager, SettingsValidationError
from .const import (
    DOMAIN,
    CONF_USERNAME,
    CONF_PASSWORD,
    CONF_RECOVERY_ENABLED,
    CONF_HEARTBEAT_INTERVAL,
    CONF_MAX_DATA_AGE,
    CONF_STALE_CHECKS_THRESHOLD,
    CONF_NOTIFY_ON_RECOVERY,
    CONF_DIAGNOSTICS_MODE,
    CONF_AUTO_RECONNECT_TIME,
    CONF_HISTORY_BACKFILL_YEARS,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_RECOVERY_ENABLED,
    DEFAULT_HEARTBEAT_INTERVAL,
    DEFAULT_MAX_DATA_AGE,
    DEFAULT_STALE_CHECKS_THRESHOLD,
    DEFAULT_NOTIFY_ON_RECOVERY,
    DEFAULT_DIAGNOSTICS_MODE,
    DEFAULT_AUTO_RECONNECT_TIME,
    DEFAULT_HISTORY_BACKFILL_YEARS,
    SERVICE_SET_DISCHARGE_TIME,
    SERVICE_SET_DISCHARGE_START_TIME,
    SERVICE_SET_CHARGE_START_TIME,
    SERVICE_SET_CHARGE_END_TIME,
    SERVICE_SET_MINIMUM_SOC,
    SERVICE_SET_CHARGE_CAP,
    SERVICE_UPDATE_BATTERY_SETTINGS,
    SERVICE_FORCE_RECONNECT,
    SERVICE_HEALTH_CHECK,
    SERVICE_REFRESH_NOW,
    SERVICE_TOGGLE_DIAGNOSTICS,
    SERVICE_ENSURE_REPORT_HISTORY,
    ATTR_END_DISCHARGE,
    ATTR_START_DISCHARGE,
    ATTR_START_CHARGE,
    ATTR_END_CHARGE,
    ATTR_MINIMUM_SOC,
    ATTR_CHARGE_CAP,
    SERVICE_SET_GRID_FEEDIN_ENABLED,
    SERVICE_SET_GRID_FEEDIN_CUTOFF_SOC,
    SERVICE_UPDATE_GRID_FEEDIN_SLOT,
    SERVICE_DELETE_GRID_FEEDIN_SLOT,
    SERVICE_UPDATE_BATTERY_SLOT,
    SERVICE_DELETE_BATTERY_SLOT,
    SERVICE_START_FORCE_CHARGE,
    SERVICE_STOP_FORCE_CHARGE,
    SERVICE_START_DISCHARGE_NOW,
    SERVICE_STOP_DISCHARGE_NOW,
    SERVICE_START_FEEDIN_NOW,
    SERVICE_STOP_FEEDIN_NOW,
    ATTR_FEEDIN_ENABLED,
    ATTR_FEEDIN_CUTOFF_SOC,
    ATTR_FEEDIN_SLOT,
    ATTR_FEEDIN_START,
    ATTR_FEEDIN_END,
    ATTR_FEEDIN_POWER,
    ATTR_POLICY_KIND,
    ATTR_SLOT,
    ATTR_SLOT_SOC,
    ATTR_SLOT_WEEKS,
    ATTR_DURATION_MINUTES,
    ATTR_ENTRY_ID,
    ATTR_FORCE,
    ATTR_SCOPE_KEY,
    ATTR_START_DATE,
    ATTR_END_DATE,
    CONF_HOST_SYSTEM_ID,
    CONF_HOST_SYS_SN,
    CURRENT_ENTRY_VERSION,
    FEEDIN_MAX_SLOTS,
    FEEDIN_MAX_POWER_W,
    BATTERY_DAILY_MAX_SLOTS,
    BATTERY_WEEKLY_MAX_SLOTS,
    SENSOR_TOTAL_BATTERY_DISCHARGE,
)

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS = ["sensor", "number", "time", "switch", "button", "select"]

# Services are domain-level; registration is idempotent so reloads can add new services.


# ---------------------------------------------------------------------------
# Setup / unload / migrate
# ---------------------------------------------------------------------------

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Byte-Watt from a config entry."""
    username = entry.data[CONF_USERNAME]
    password = entry.data[CONF_PASSWORD]
    host_system_id = entry.data.get(CONF_HOST_SYSTEM_ID, "")
    host_sys_sn = entry.data.get(CONF_HOST_SYS_SN, "")

    options = entry.options or {}
    scan_interval = options.get(
        CONF_SCAN_INTERVAL,
        entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
    )

    recovery_options = {
        CONF_RECOVERY_ENABLED:        options.get(CONF_RECOVERY_ENABLED, DEFAULT_RECOVERY_ENABLED),
        CONF_HEARTBEAT_INTERVAL:      options.get(CONF_HEARTBEAT_INTERVAL, DEFAULT_HEARTBEAT_INTERVAL),
        CONF_MAX_DATA_AGE:            options.get(CONF_MAX_DATA_AGE, DEFAULT_MAX_DATA_AGE),
        CONF_STALE_CHECKS_THRESHOLD:  options.get(CONF_STALE_CHECKS_THRESHOLD, DEFAULT_STALE_CHECKS_THRESHOLD),
        CONF_NOTIFY_ON_RECOVERY:      options.get(CONF_NOTIFY_ON_RECOVERY, DEFAULT_NOTIFY_ON_RECOVERY),
        CONF_DIAGNOSTICS_MODE:        options.get(CONF_DIAGNOSTICS_MODE, DEFAULT_DIAGNOSTICS_MODE),
        CONF_AUTO_RECONNECT_TIME:     options.get(CONF_AUTO_RECONNECT_TIME, DEFAULT_AUTO_RECONNECT_TIME),
        CONF_HISTORY_BACKFILL_YEARS:  options.get(CONF_HISTORY_BACKFILL_YEARS, DEFAULT_HISTORY_BACKFILL_YEARS),
    }

    client = ByteWattClient(
        hass, username, password,
        host_system_id=host_system_id,
        host_sys_sn=host_sys_sn,
    )
    manager = SettingsManager(hass, client.api_client, entry.entry_id)
    coordinator = ByteWattDataUpdateCoordinator(
        hass,
        client=client,
        scan_interval=scan_interval,
        entry_id=entry.entry_id,
        options=recovery_options,
    )

    hass.data[DOMAIN][entry.entry_id] = {
        "client": client,
        "coordinator": coordinator,
        "manager": manager,
        "inverters": [],
        "aggregate_scope": client.aggregate_scope(),
        "settings_scope": client.selected_settings_scope(),
    }

    # If host is now configured, clear any leftover repair issue from prior runs.
    # If it's still empty, _check_host_inverter_repair_issue may raise one.
    if host_system_id:
        ir.async_delete_issue(hass, DOMAIN, _host_inverter_issue_id(entry.entry_id))
    else:
        _check_host_inverter_repair_issue(hass, entry, client)

    await coordinator.async_config_entry_first_refresh()

    try:
        inverters = await client.fetch_inverter_inventory()
    except Exception as ex:  # noqa: BLE001
        _LOGGER.debug("Could not refresh ByteWatt inverter inventory after setup: %s", ex)
        inverters = []
    hass.data[DOMAIN][entry.entry_id]["inverters"] = inverters
    if host_system_id:
        matched = next((inv for inv in inverters if inv.system_id == host_system_id), None)
        if matched is not None:
            hass.data[DOMAIN][entry.entry_id]["settings_scope"] = matched.to_settings_scope()

    if recovery_options[CONF_RECOVERY_ENABLED]:
        await coordinator.start_heartbeat()
        # Ensure heartbeat is stopped even if a later setup step raises before
        # async_unload_entry would otherwise clean it up.
        entry.async_on_unload(_stop_heartbeat_factory(coordinator))
        _LOGGER.info(
            "ByteWatt heartbeat monitoring started (interval: %ss, stale threshold: %ss)",
            recovery_options[CONF_HEARTBEAT_INTERVAL],
            recovery_options[CONF_MAX_DATA_AGE],
        )

    _register_services(hass)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await _cleanup_legacy_entity_ids(hass, entry)

    # Reload the entry whenever the user changes options (currently just
    # scan_interval). Without this, edits via the Configure dialog would
    # silently have no effect on the running coordinator.
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))

    return True


async def _cleanup_legacy_entity_ids(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Rename known legacy entity IDs to the cleaner current form.

    Older Byte-Watt builds could leave the total battery discharge sensor with
    an entity_id derived from the device name and account username, even
    though the unique_id already points at the stable modern sensor object.
    Keep the cleanup narrow so we don't unexpectedly rename unrelated entities.
    """
    entity_registry = er.async_get(hass)
    unique_id = f"{entry.entry_id}_{SENSOR_TOTAL_BATTERY_DISCHARGE}"
    current_entity_id = entity_registry.async_get_entity_id("sensor", DOMAIN, unique_id)
    desired_entity_id = "sensor.total_battery_discharge"

    if not current_entity_id or current_entity_id == desired_entity_id:
        return

    existing = entity_registry.async_get(desired_entity_id)
    if existing is not None:
        _LOGGER.debug(
            "Skipping Byte-Watt legacy entity rename because %s already exists",
            desired_entity_id,
        )
        return

    if "total_battery_discharge" not in current_entity_id:
        return

    _LOGGER.info(
        "Renaming legacy Byte-Watt entity %s -> %s",
        current_entity_id,
        desired_entity_id,
    )
    entity_registry.async_update_entity(
        current_entity_id,
        new_entity_id=desired_entity_id,
    )


def _stop_heartbeat_factory(coordinator):
    """Return a sync callback that schedules stop_heartbeat — for async_on_unload."""
    def _stop():
        coordinator.hass.async_create_task(coordinator.stop_heartbeat())
    return _stop


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload the entry so option changes (e.g. scan_interval) take effect."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    entry_data = hass.data[DOMAIN].get(entry.entry_id)

    # Warn the user if they have unsaved pending changes that will be lost
    if entry_data:
        manager: SettingsManager | None = entry_data.get("manager")
        if manager is not None and manager.has_pending():
            count = manager.pending_count()
            _LOGGER.warning(
                "Unloading with %d pending settings change(s) still staged — these will be lost",
                count,
            )
            try:
                notify_create(
                    hass,
                    f"ByteWatt integration is unloading with {count} unsaved setting "
                    f"change(s) staged. These have been discarded.",
                    title="ByteWatt: pending changes lost",
                    notification_id=f"bytewatt_pending_lost_{entry.entry_id}",
                )
            except (AttributeError, TypeError) as ex:
                _LOGGER.debug("Could not create pending-lost notification: %s", ex)

        coordinator = entry_data.get("coordinator")
        if coordinator:
            await coordinator.stop_heartbeat()
            _LOGGER.info("ByteWatt heartbeat monitoring stopped")

    unload_ok = all(
        await asyncio.gather(
            *[
                hass.config_entries.async_forward_entry_unload(entry, platform)
                for platform in PLATFORMS
            ]
        )
    )
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Migrate older config entries to the current schema.

    v1 → v2: introduces ``host_system_id`` / ``host_sys_sn`` (added when the
    Host inverter selection step was added). Try to populate them
    automatically when only one inverter exists; otherwise raise a repair
    issue prompting the user to reconfigure.
    """
    _LOGGER.info("Migrating ByteWatt entry from v%s to v%s", entry.version, CURRENT_ENTRY_VERSION)

    if entry.version < 2:
        new_data = dict(entry.data)
        new_data.setdefault(CONF_HOST_SYSTEM_ID, "")
        new_data.setdefault(CONF_HOST_SYS_SN, "")

        # Track inverter count explicitly so the post-migration decision
        # below doesn't depend on whether a variable got bound inside a
        # try-block (the previous walrus-via-locals() pattern was brittle).
        inverter_count: Optional[int] = None

        if not new_data[CONF_HOST_SYSTEM_ID]:
            client = ByteWattClient(
                hass,
                new_data[CONF_USERNAME],
                new_data[CONF_PASSWORD],
            )
            try:
                logged_in = await client.initialize()
                if logged_in:
                    inverters = await client.fetch_inverter_inventory()
                    inverter_count = len(inverters)
                    if inverter_count == 1:
                        new_data[CONF_HOST_SYSTEM_ID] = inverters[0].system_id
                        new_data[CONF_HOST_SYS_SN] = inverters[0].sys_sn
                        _LOGGER.info(
                            "Auto-selected single inverter %s as Host",
                            new_data[CONF_HOST_SYS_SN],
                        )
                    elif inverter_count == 0:
                        _LOGGER.warning(
                            "Migration found no inverters on the account — "
                            "grid feed-in will be unavailable. Reconfigure if you add one."
                        )
                    else:
                        _LOGGER.info(
                            "Migration found %d inverters; user must pick the Host",
                            inverter_count,
                        )
                else:
                    _LOGGER.warning(
                        "Could not log in during migration; "
                        "host_system_id stays empty and a repair issue will be raised"
                    )
            except Exception as ex:  # noqa: BLE001 — migration must never crash
                _LOGGER.warning("Migration could not fetch inverter list: %s", ex)

        # Raise a repair issue only when we KNOW there are multiple inverters
        # and we still don't have a host. Login failures (inverter_count is
        # None) and 0-inverter accounts don't reach this — they get warning
        # logs above.
        if (
            not new_data[CONF_HOST_SYSTEM_ID]
            and inverter_count is not None
            and inverter_count > 1
        ):
            _create_host_inverter_repair_issue(hass, entry.entry_id)

        # Backfill unique_id from the username (matching what the config
        # flow now sets for new installs) so dedup checks recognise this
        # entry on subsequent re-add attempts.
        unique_id = (entry.unique_id or new_data[CONF_USERNAME].lower())
        hass.config_entries.async_update_entry(
            entry,
            data=new_data,
            unique_id=unique_id,
            version=CURRENT_ENTRY_VERSION,
        )

    return True


# ---------------------------------------------------------------------------
# Repair issues
# ---------------------------------------------------------------------------

def _host_inverter_issue_id(entry_id: str) -> str:
    return f"host_inverter_required_{entry_id}"


def _create_host_inverter_repair_issue(hass: HomeAssistant, entry_id: str) -> None:
    """Tell the user to reconfigure to pick the Host inverter."""
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id=_host_inverter_issue_id(entry_id),
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="host_inverter_required",
    )


def _check_host_inverter_repair_issue(
    hass: HomeAssistant, entry: ConfigEntry, client: ByteWattClient
) -> None:
    """Recheck after setup if host_system_id is empty AND an inverter has
    appeared on the account (e.g. user added one between HA restarts).

    Skips when the repair issue is already raised — otherwise we'd re-login
    on every restart even though the user has been told to reconfigure.
    coordinator.async_config_entry_first_refresh() is doing its own login
    moments after setup; this background check is purely about issue state.
    """
    issue_id = _host_inverter_issue_id(entry.entry_id)
    if ir.async_get(hass).async_get_issue(DOMAIN, issue_id) is not None:
        return  # Already telling the user to reconfigure; no extra login needed.

    async def _check():
        try:
            if not await client.initialize():
                return
            inverters = await client.fetch_inverter_inventory()
            # >= 1 because async_setup_entry only called this when
            # host_system_id is empty — any inverter at all is enough to
            # justify prompting the user to pick one.
            if len(inverters) >= 1:
                _create_host_inverter_repair_issue(hass, entry.entry_id)
        except Exception as ex:  # noqa: BLE001
            _LOGGER.debug("Could not check inverter count for repair issue: %s", ex)

    # Tie the task to the entry so HA cancels it if the entry unloads mid-check.
    entry.async_create_task(hass, _check())


# ---------------------------------------------------------------------------
# Services — registered once at domain level, accept optional entry_id
# ---------------------------------------------------------------------------

def _resolve_entry_id(hass: HomeAssistant, call: ServiceCall) -> str | None:
    """Use the explicit entry_id if given; otherwise the first entry if only one exists."""
    requested = call.data.get(ATTR_ENTRY_ID)
    entries = list(hass.data.get(DOMAIN, {}).keys())
    if requested:
        if requested not in entries:
            raise HomeAssistantError(
                f"Unknown ByteWatt entry_id {requested!r}. Configured entries: {entries}"
            )
        return requested
    if len(entries) == 1:
        return entries[0]
    if not entries:
        raise HomeAssistantError("No ByteWatt integration is configured")
    raise HomeAssistantError(
        f"Multiple ByteWatt integrations are configured — pass entry_id to "
        f"disambiguate. Available: {entries}"
    )


def _manager_for(hass: HomeAssistant, call: ServiceCall) -> SettingsManager:
    entry_id = _resolve_entry_id(hass, call)
    return hass.data[DOMAIN][entry_id]["manager"]


def _coordinator_for(hass: HomeAssistant, call: ServiceCall):
    entry_id = _resolve_entry_id(hass, call)
    return hass.data[DOMAIN][entry_id]["coordinator"]


async def _submit_battery_service(
    hass: HomeAssistant, call: ServiceCall, **fields: Any
) -> bool:
    """Service-call entry point: validate + PUT one or more battery fields.

    Uses submit_battery_one_shot so the service does NOT touch the user's
    UI-staged pending changes. Service-call fire-and-forget UX is preserved
    while keeping the Submit-button flow's pending dict isolated.
    """
    manager = _manager_for(hass, call)
    result = await manager.submit_battery_one_shot(fields)
    if not result.battery_attempted:
        return True
    if not result.battery_ok:
        detail = result.battery_error or "see logs for details"
        raise HomeAssistantError(f"Battery settings update failed: {detail}")
    return True


def _register_services(hass: HomeAssistant) -> None:
    """Register all domain-level services."""

    def _register(service_name: str, handler, *, schema) -> None:
        if hass.services.has_service(DOMAIN, service_name):
            return
        hass.services.async_register(
            DOMAIN,
            service_name,
            handler,
            schema=schema,
        )

    # ---------- Battery: single-field convenience services ----------

    async def handle_set_discharge_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, discharge_end_time=call.data.get(ATTR_END_DISCHARGE),
        )

    async def handle_set_discharge_start_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, discharge_start_time=call.data.get(ATTR_START_DISCHARGE),
        )

    async def handle_set_charge_start_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_start_time=call.data.get(ATTR_START_CHARGE),
        )

    async def handle_set_charge_end_time(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_end_time=call.data.get(ATTR_END_CHARGE),
        )

    async def handle_set_minimum_soc(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, minimum_soc=call.data.get(ATTR_MINIMUM_SOC),
        )

    async def handle_set_charge_cap(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call, charge_cap=call.data.get(ATTR_CHARGE_CAP),
        )

    async def handle_update_battery_settings(call: ServiceCall) -> None:
        await _submit_battery_service(
            hass, call,
            discharge_start_time=call.data.get(ATTR_START_DISCHARGE),
            discharge_end_time=call.data.get(ATTR_END_DISCHARGE),
            charge_start_time=call.data.get(ATTR_START_CHARGE),
            charge_end_time=call.data.get(ATTR_END_CHARGE),
            minimum_soc=call.data.get(ATTR_MINIMUM_SOC),
            charge_cap=call.data.get(ATTR_CHARGE_CAP),
        )

    # ---------- Grid feed-in ----------

    async def handle_set_grid_feedin_enabled(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            manager.stage_feedin("enabled", call.data[ATTR_FEEDIN_ENABLED])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in enable update failed: {detail}")
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_set_grid_feedin_cutoff_soc(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            manager.stage_feedin("cutoff_soc", call.data[ATTR_FEEDIN_CUTOFF_SOC])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in cutoff SOC update failed: {detail}")
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_update_grid_feedin_slot(call: ServiceCall) -> None:
        slot_1based = call.data[ATTR_FEEDIN_SLOT]
        slot_index = int(slot_1based) - 1
        start = call.data.get(ATTR_FEEDIN_START)
        end = call.data.get(ATTR_FEEDIN_END)
        power = call.data.get(ATTR_FEEDIN_POWER)
        if start is None and end is None and power is None:
            _LOGGER.debug("update_grid_feedin_slot called with no fields — nothing to do")
            return
        manager = _manager_for(hass, call)
        try:
            if start is not None:
                manager.stage_feedin_slot(slot_index, "start", start)
            if end is not None:
                manager.stage_feedin_slot(slot_index, "end", end)
            if power is not None:
                manager.stage_feedin_slot(slot_index, "power", power)
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        result = await manager.submit()
        if not result.feedin_ok:
            detail = result.feedin_error or "see logs for details"
            raise HomeAssistantError(f"Grid feed-in slot update failed: {detail}")
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_delete_grid_feedin_slot(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.delete_feedin_slot(call.data[ATTR_SLOT])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_update_battery_slot(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.update_battery_slot(
                call.data[ATTR_POLICY_KIND],
                call.data[ATTR_SLOT],
                start=call.data.get(ATTR_FEEDIN_START),
                end=call.data.get(ATTR_FEEDIN_END),
                soc=call.data.get(ATTR_SLOT_SOC),
                power=call.data.get(ATTR_FEEDIN_POWER),
                weeks=call.data.get(ATTR_SLOT_WEEKS),
            )
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_delete_battery_slot(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.delete_battery_slot(
                call.data[ATTR_POLICY_KIND], call.data[ATTR_SLOT]
            )
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_start_force_charge(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.force_charge_start(call.data[ATTR_CHARGE_CAP])
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_stop_force_charge(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.force_charge_stop()
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_start_discharge_now(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.start_discharge_now(
                duration_minutes=call.data.get(ATTR_DURATION_MINUTES, 60),
                soc=call.data[ATTR_SLOT_SOC],
                power=call.data[ATTR_FEEDIN_POWER],
            )
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_stop_discharge_now(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.stop_discharge_now()
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_start_feedin_now(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.start_feedin_now(
                duration_minutes=call.data.get(ATTR_DURATION_MINUTES, 60),
                power=call.data[ATTR_FEEDIN_POWER],
            )
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    async def handle_stop_feedin_now(call: ServiceCall) -> None:
        manager = _manager_for(hass, call)
        try:
            await manager.stop_feedin_now()
        except SettingsValidationError as ex:
            raise HomeAssistantError(str(ex)) from ex
        await _coordinator_for(hass, call).async_request_refresh()

    # ---------- Maintenance ----------

    async def handle_force_reconnect(call: ServiceCall) -> None:
        _LOGGER.warning("Manual reconnect triggered for ByteWatt integration")
        target_entry = call.data.get(ATTR_ENTRY_ID)
        reconnected = False
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if not coordinator:
                continue
            try:
                await coordinator._perform_recovery()
                reconnected = True
                _LOGGER.info("Recovery completed for entry %s", entry_id)
            except Exception as err:  # noqa: BLE001 — surface in notification
                _LOGGER.error("Failed to recover entry %s: %s", entry_id, err)
        if not reconnected:
            _LOGGER.error("No active ByteWatt integrations found to reconnect")

    async def handle_health_check(call: ServiceCall) -> None:
        results = {}
        target_entry = call.data.get(ATTR_ENTRY_ID)
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if coordinator:
                results[entry_id] = await coordinator.run_health_check()
        if not results:
            _LOGGER.error("No ByteWatt integrations found for health check")
            return
        summary_lines = []
        for entry_id, result in results.items():
            status = result.get("connection_status", "unknown")
            auth_ok = result.get("authentication", {}).get("success", False)
            api_ok = all(c.get("success", False) for c in result.get("api_checks", {}).values())
            summary_lines.append(
                f"Integration {entry_id}: {status} — "
                f"Authentication: {'OK' if auth_ok else 'FAIL'}, "
                f"API: {'OK' if api_ok else 'FAIL'}"
            )
        try:
            notify_create(
                hass,
                "\n".join(summary_lines),
                title="ByteWatt Health Check Results",
                notification_id="bytewatt_health_check",
            )
        except (AttributeError, TypeError) as ex:
            _LOGGER.error("Could not create health check notification: %s", ex)

    async def handle_refresh_now(call: ServiceCall) -> None:
        target_entry = call.data.get(ATTR_ENTRY_ID)
        refreshed = 0
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if not coordinator:
                continue
            await coordinator.async_request_refresh()
            refreshed += 1
        if not refreshed:
            _LOGGER.debug("No ByteWatt integrations found to refresh")

    async def handle_toggle_diagnostics(call: ServiceCall) -> None:
        enable = call.data.get("enable")
        target_entry = call.data.get(ATTR_ENTRY_ID)
        results = {}
        for entry_id, entry_data in hass.data[DOMAIN].items():
            if target_entry and entry_id != target_entry:
                continue
            coordinator = entry_data.get("coordinator")
            if coordinator:
                results[entry_id] = coordinator.toggle_diagnostics_mode(enable)
        if results:
            enabled_now = list(results.values())[0].get("diagnostics_mode", False)
            try:
                notify_create(
                    hass,
                    f"Diagnostics mode: {'enabled' if enabled_now else 'disabled'}",
                    title="ByteWatt Diagnostics",
                    notification_id="bytewatt_diagnostics",
                )
            except (AttributeError, TypeError) as ex:
                _LOGGER.error("Could not create diagnostics notification: %s", ex)
        else:
            _LOGGER.error("No ByteWatt integrations found to toggle diagnostics")

    async def handle_ensure_report_history(call: ServiceCall) -> None:
        _LOGGER.info(
            "ByteWatt ensure_report_history called for scope=%s start=%s end=%s entry_id=%s force=%s",
            call.data.get(ATTR_SCOPE_KEY, "all"),
            call.data.get(ATTR_START_DATE),
            call.data.get(ATTR_END_DATE),
            call.data.get(ATTR_ENTRY_ID),
            call.data.get(ATTR_FORCE, False),
        )
        coordinator = _coordinator_for(hass, call)
        result = await coordinator.async_ensure_history_range(
            scope_key=call.data.get(ATTR_SCOPE_KEY, "all"),
            start_date=call.data[ATTR_START_DATE],
            end_date=call.data[ATTR_END_DATE],
            force=bool(call.data.get(ATTR_FORCE, False)),
        )
        _LOGGER.info(
            "ByteWatt history ensured for %s (%s to %s): %s/%s available, %s downloaded",
            result["scope_key"],
            result["start_date"],
            result["end_date"],
            result["available"],
            result["requested"],
            result["downloaded"],
        )

    # ---------- Schemas ----------

    _time_schema = vol.All(cv.string)
    _soc_schema = vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
    _feedin_power_schema = vol.All(vol.Coerce(int), vol.Range(min=0, max=FEEDIN_MAX_POWER_W))
    _battery_power_schema = vol.All(vol.Coerce(int), vol.Range(min=0, max=50000))
    _entry_id_opt = {vol.Optional(ATTR_ENTRY_ID): cv.string}

    _register(
        SERVICE_SET_DISCHARGE_TIME,
        handle_set_discharge_time,
        schema=vol.Schema({vol.Required(ATTR_END_DISCHARGE): _time_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_DISCHARGE_START_TIME,
        handle_set_discharge_start_time,
        schema=vol.Schema({vol.Required(ATTR_START_DISCHARGE): _time_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_CHARGE_START_TIME,
        handle_set_charge_start_time,
        schema=vol.Schema({vol.Required(ATTR_START_CHARGE): _time_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_CHARGE_END_TIME,
        handle_set_charge_end_time,
        schema=vol.Schema({vol.Required(ATTR_END_CHARGE): _time_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_MINIMUM_SOC,
        handle_set_minimum_soc,
        schema=vol.Schema({vol.Required(ATTR_MINIMUM_SOC): _soc_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_CHARGE_CAP,
        handle_set_charge_cap,
        schema=vol.Schema({vol.Required(ATTR_CHARGE_CAP): _soc_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_UPDATE_BATTERY_SETTINGS,
        handle_update_battery_settings,
        schema=vol.Schema({
            vol.Optional(ATTR_START_DISCHARGE): _time_schema,
            vol.Optional(ATTR_END_DISCHARGE): _time_schema,
            vol.Optional(ATTR_START_CHARGE): _time_schema,
            vol.Optional(ATTR_END_CHARGE): _time_schema,
            vol.Optional(ATTR_MINIMUM_SOC): _soc_schema,
            vol.Optional(ATTR_CHARGE_CAP): _soc_schema,
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_SET_GRID_FEEDIN_ENABLED,
        handle_set_grid_feedin_enabled,
        schema=vol.Schema({vol.Required(ATTR_FEEDIN_ENABLED): cv.boolean, **_entry_id_opt}),
    )
    _register(
        SERVICE_SET_GRID_FEEDIN_CUTOFF_SOC,
        handle_set_grid_feedin_cutoff_soc,
        schema=vol.Schema({
            vol.Required(ATTR_FEEDIN_CUTOFF_SOC): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_UPDATE_GRID_FEEDIN_SLOT,
        handle_update_grid_feedin_slot,
        schema=vol.Schema({
            vol.Required(ATTR_FEEDIN_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=FEEDIN_MAX_SLOTS)),
            vol.Optional(ATTR_FEEDIN_START): _time_schema,
            vol.Optional(ATTR_FEEDIN_END): _time_schema,
            vol.Optional(ATTR_FEEDIN_POWER): _feedin_power_schema,
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_DELETE_GRID_FEEDIN_SLOT,
        handle_delete_grid_feedin_slot,
        schema=vol.Schema({
            vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=FEEDIN_MAX_SLOTS)),
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_UPDATE_BATTERY_SLOT,
        handle_update_battery_slot,
        schema=vol.Schema({
            vol.Required(ATTR_POLICY_KIND): vol.In(["charge", "discharge"]),
            vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=BATTERY_WEEKLY_MAX_SLOTS)),
            vol.Optional(ATTR_FEEDIN_START): _time_schema,
            vol.Optional(ATTR_FEEDIN_END): _time_schema,
            vol.Optional(ATTR_SLOT_SOC): _soc_schema,
            vol.Optional(ATTR_FEEDIN_POWER): _battery_power_schema,
            vol.Optional(ATTR_SLOT_WEEKS): [vol.All(vol.Coerce(int), vol.Range(min=1, max=7))],
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_DELETE_BATTERY_SLOT,
        handle_delete_battery_slot,
        schema=vol.Schema({
            vol.Required(ATTR_POLICY_KIND): vol.In(["charge", "discharge"]),
            vol.Required(ATTR_SLOT): vol.All(vol.Coerce(int), vol.Range(min=1, max=BATTERY_WEEKLY_MAX_SLOTS)),
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_START_FORCE_CHARGE,
        handle_start_force_charge,
        schema=vol.Schema({vol.Required(ATTR_CHARGE_CAP): _soc_schema, **_entry_id_opt}),
    )
    _register(
        SERVICE_STOP_FORCE_CHARGE,
        handle_stop_force_charge,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_START_DISCHARGE_NOW,
        handle_start_discharge_now,
        schema=vol.Schema({
            vol.Required(ATTR_SLOT_SOC): _soc_schema,
            vol.Required(ATTR_FEEDIN_POWER): _battery_power_schema,
            vol.Optional(ATTR_DURATION_MINUTES, default=60): vol.All(vol.Coerce(int), vol.Range(min=1, max=1439)),
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_STOP_DISCHARGE_NOW,
        handle_stop_discharge_now,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_START_FEEDIN_NOW,
        handle_start_feedin_now,
        schema=vol.Schema({
            vol.Required(ATTR_FEEDIN_POWER): _feedin_power_schema,
            vol.Optional(ATTR_DURATION_MINUTES, default=60): vol.All(vol.Coerce(int), vol.Range(min=1, max=1439)),
            **_entry_id_opt,
        }),
    )
    _register(
        SERVICE_STOP_FEEDIN_NOW,
        handle_stop_feedin_now,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_FORCE_RECONNECT,
        handle_force_reconnect,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_HEALTH_CHECK,
        handle_health_check,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_REFRESH_NOW,
        handle_refresh_now,
        schema=vol.Schema(_entry_id_opt),
    )
    _register(
        SERVICE_TOGGLE_DIAGNOSTICS,
        handle_toggle_diagnostics,
        schema=vol.Schema({vol.Optional("enable"): cv.boolean, **_entry_id_opt}),
    )
    _register(
        SERVICE_ENSURE_REPORT_HISTORY,
        handle_ensure_report_history,
        schema=vol.Schema({
            vol.Required(ATTR_START_DATE): cv.string,
            vol.Required(ATTR_END_DATE): cv.string,
            vol.Optional(ATTR_SCOPE_KEY, default="all"): cv.string,
            vol.Optional(ATTR_FORCE, default=False): cv.boolean,
            **_entry_id_opt,
        }),
    )
