"""Shared reporting helpers and local history persistence for Byte-Watt."""
from __future__ import annotations

import csv
import json
import logging
import re
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

HISTORY_DIR_NAME = "bytewatt-history"
HISTORY_FILE_NAME = "history.json"


def build_reporting_payload(
    battery_data: dict[str, Any],
    *,
    aggregate: bool,
    label: str,
) -> dict[str, Any]:
    """Build the compact reporting payload used by the custom Lovelace cards."""
    power_diagram = battery_data.get("Power_Diagram") or {}
    reporting_date = str(power_diagram.get("date") or dt_util.now().date().isoformat())
    saved_at = dt_util.utcnow().isoformat()
    return {
        "aggregate": aggregate,
        "label": label,
        "reporting_date": reporting_date,
        "meta": {
            "aggregate": aggregate,
            "label": label,
            "reporting_date": reporting_date,
            "saved_at": saved_at,
        },
        "live": {
            "soc": battery_data.get("soc"),
            "battery_power": battery_data.get("pbat"),
            "house_consumption": battery_data.get("pload"),
            "grid_power": battery_data.get("pgrid"),
            "pv_power": battery_data.get("ppv"),
            "power_source": battery_data.get("powerSource"),
        },
        "today": {
            "solar_generation": battery_data.get("PV_Generated_Today"),
            "load_consumption": battery_data.get("Consumed_Today"),
            "feed_in": battery_data.get("Feed_In_Today"),
            "grid_consumption": battery_data.get("Grid_Import_Today"),
            "battery_charge": battery_data.get("Battery_Charged_Today"),
            "battery_discharge": battery_data.get("Battery_Discharged_Today"),
            "self_consumption": battery_data.get("Self_Consumption"),
            "self_sufficiency": battery_data.get("Self_Sufficiency"),
            "trees_planted": battery_data.get("Trees_Planted"),
            "co2_reduction_tons": battery_data.get("CO2_Reduction_Tons"),
            "today_income": battery_data.get("Today_Income"),
            "total_income": battery_data.get("Total_Income"),
        },
        "totals": {
            "solar_generation": battery_data.get("Total_Solar_Generation") or battery_data.get("PV_Generated_Today"),
            "feed_in": battery_data.get("Total_Feed_In") or battery_data.get("Feed_In_Today"),
            "battery_charge": battery_data.get("Total_Battery_Charge") or battery_data.get("Battery_Charged_Today"),
            "battery_discharge": battery_data.get("Total_Battery_Discharge") or battery_data.get("Battery_Discharged_Today"),
            "house_consumption": battery_data.get("Total_House_Consumption") or battery_data.get("Consumed_Today"),
            "grid_consumption": battery_data.get("Grid_Power_Consumption") or battery_data.get("Grid_Import_Today"),
            "pv_power_house": battery_data.get("PV_Power_House") or 0,
            "pv_charging_battery": battery_data.get("PV_Charging_Battery") or 0,
            "grid_battery_charge": battery_data.get("Grid_Based_Battery_Charge") or 0,
        },
        "power_diagram": power_diagram,
    }


def _safe_filename(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value or "").strip("._-")
    return value or "all"


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _csv_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, default=_json_default, ensure_ascii=False, separators=(",", ":"))
    else:
        value = str(value)
    return value


def _summary_row(
    *,
    scope_key: str,
    label: str,
    record_date: str,
    reporting: dict[str, Any],
) -> dict[str, Any]:
    live = reporting.get("live") or {}
    today = reporting.get("today") or {}
    totals = reporting.get("totals") or {}
    power_diagram = _power_diagram_from_reporting(reporting)
    series = power_diagram.get("series") or {}

    return {
        "record_date": record_date,
        "scope_key": scope_key,
        "label": label,
        "aggregate": reporting.get("aggregate", False),
        "reporting_date": power_diagram.get("date") or "",
        "saved_at": reporting.get("meta", {}).get("saved_at") or "",
        "live_soc": live.get("soc"),
        "live_battery_power": live.get("battery_power"),
        "live_load_power": live.get("house_consumption"),
        "live_grid_power": live.get("grid_power"),
        "live_pv_power": live.get("pv_power"),
        "power_source": live.get("power_source"),
        "solar_generation_today": today.get("solar_generation"),
        "load_consumption_today": today.get("load_consumption"),
        "feed_in_today": today.get("feed_in"),
        "grid_consumption_today": today.get("grid_consumption"),
        "battery_charged_today": today.get("battery_charge"),
        "battery_discharged_today": today.get("battery_discharge"),
        "self_consumption": today.get("self_consumption"),
        "self_sufficiency": today.get("self_sufficiency"),
        "trees_planted": today.get("trees_planted"),
        "co2_reduction_tons": today.get("co2_reduction_tons"),
        "today_income": today.get("today_income"),
        "total_income": today.get("total_income"),
        "total_solar_generation": totals.get("solar_generation"),
        "total_feed_in": totals.get("feed_in"),
        "total_battery_charge": totals.get("battery_charge"),
        "total_battery_discharge": totals.get("battery_discharge"),
        "total_house_consumption": totals.get("house_consumption"),
        "total_grid_consumption": totals.get("grid_consumption"),
        "pv_power_house": totals.get("pv_power_house"),
        "pv_charging_battery": totals.get("pv_charging_battery"),
        "grid_battery_charge": totals.get("grid_battery_charge"),
        "chart_time": json.dumps(power_diagram.get("time") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_bat": json.dumps(series.get("bat") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_load": json.dumps(series.get("load") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_solar": json.dumps(series.get("solar") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_feed_in": json.dumps(series.get("feed_in") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
        "chart_consumed": json.dumps(series.get("consumed") or [], default=_json_default, ensure_ascii=False, separators=(",", ":")),
    }


def _power_diagram_from_reporting(reporting: dict[str, Any]) -> dict[str, Any]:
    """Return a nested or bare power diagram payload when one exists."""
    if not isinstance(reporting, dict):
        return {}
    power_diagram = reporting.get("power_diagram")
    if isinstance(power_diagram, dict) and power_diagram:
        return power_diagram
    bare_keys = ("time", "series", "summary", "date", "meta")
    if any(key in reporting for key in bare_keys):
        return reporting
    return {}


def _reporting_has_power_diagram_data(reporting: dict[str, Any]) -> bool:
    """Return True when a stored row has chart data worth treating as archived."""
    power_diagram = _power_diagram_from_reporting(reporting)
    if not isinstance(power_diagram, dict) or not power_diagram:
        return False
    time_points = power_diagram.get("time") or []
    if isinstance(time_points, list) and len(time_points) > 0:
        return True
    series = power_diagram.get("series") or {}
    if isinstance(series, dict):
        for value in series.values():
            if isinstance(value, list) and len(value) > 0:
                return True
    return False


class ByteWattReportHistory:
    """Persist one local snapshot per date and scope."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self.base_dir = Path(hass.config.path("www", HISTORY_DIR_NAME, entry_id))
        self.history_file = self.base_dir / HISTORY_FILE_NAME

    async def async_store_snapshot(
        self,
        *,
        scope_key: str,
        label: str,
        reporting: dict[str, Any],
        record_date: str | None = None,
    ) -> None:
        """Store a daily snapshot and regenerate the CSV summary."""
        payload = deepcopy(reporting)
        scope_key = _safe_filename(scope_key)
        label = label or payload.get("label") or scope_key
        record_date = record_date or str(
            payload.get("power_diagram", {}).get("date")
            or dt_util.now().date().isoformat()
        )
        payload["reporting_date"] = record_date
        meta = payload.setdefault("meta", {})
        if isinstance(meta, dict):
            meta["reporting_date"] = record_date
        power_diagram = payload.setdefault("power_diagram", {})
        if isinstance(power_diagram, dict):
            power_diagram["date"] = record_date

        try:
            await self.hass.async_add_executor_job(
                self._store_snapshot_sync,
                scope_key,
                label,
                record_date,
                payload,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to persist ByteWatt history for %s (%s): %s",
                scope_key,
                record_date,
                err,
            )

    async def async_mark_missing_date(
        self,
        *,
        scope_key: str,
        label: str,
        record_date: str,
        reason: str = "no_reporting_data",
    ) -> None:
        """Persist a known-missing date so it is not re-requested forever."""
        scope_key = _safe_filename(scope_key)
        try:
            await self.hass.async_add_executor_job(
                self._mark_missing_date_sync,
                scope_key,
                label or scope_key,
                record_date,
                reason,
            )
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning(
                "Failed to persist missing ByteWatt history date for %s (%s): %s",
                scope_key,
                record_date,
                err,
            )

    async def async_record_dates(self, scope_key: str) -> set[str]:
        """Return the known record dates for a scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self._record_dates_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read ByteWatt history dates for %s: %s", scope_key, err)
            return set()

    async def async_missing_dates(self, scope_key: str) -> dict[str, dict[str, Any]]:
        """Return the known missing-date markers for a scope."""
        scope_key = _safe_filename(scope_key)
        try:
            return await self.hass.async_add_executor_job(self._missing_dates_sync, scope_key)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Failed to read ByteWatt missing dates for %s: %s", scope_key, err)
            return {}

    def _store_snapshot_sync(
        self,
        scope_key: str,
        label: str,
        record_date: str,
        reporting: dict[str, Any],
    ) -> None:
        if not _reporting_has_power_diagram_data(reporting):
            _LOGGER.debug(
                "Skipping ByteWatt history snapshot for %s (%s): no chart data",
                scope_key,
                record_date,
            )
            return
        self.base_dir.mkdir(parents=True, exist_ok=True)

        if self.history_file.exists():
            try:
                history = json.loads(self.history_file.read_text(encoding="utf-8"))
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
                history = {}
        else:
            history = {}

        scopes = history.setdefault("scopes", {})
        scope = scopes.setdefault(
            scope_key,
            {
                "label": label,
                "records": {},
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", {})
        records[record_date] = reporting
        missing_dates = scope.get("missing_dates")
        if isinstance(missing_dates, dict) and record_date in missing_dates:
            missing_dates.pop(record_date, None)
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()

        self.history_file.write_text(
            json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
            encoding="utf-8",
        )
        self._write_scope_csv(scope_key, label, scope.get("records", {}))

    def _mark_missing_date_sync(
        self,
        scope_key: str,
        label: str,
        record_date: str,
        reason: str,
    ) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

        if self.history_file.exists():
            try:
                history = json.loads(self.history_file.read_text(encoding="utf-8"))
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
                history = {}
        else:
            history = {}

        scopes = history.setdefault("scopes", {})
        scope = scopes.setdefault(
            scope_key,
            {
                "label": label,
                "records": {},
                "missing_dates": {},
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", {})
        existing_record = records.get(record_date)
        if _reporting_has_power_diagram_data(existing_record or {}):
            missing_dates = scope.setdefault("missing_dates", {})
            if isinstance(missing_dates, list):
                missing_dates = {str(item): {"reason": reason} for item in missing_dates if item}
                scope["missing_dates"] = missing_dates
            if isinstance(missing_dates, dict) and record_date in missing_dates:
                missing_dates.pop(record_date, None)
                history["version"] = 1
                history["updated"] = dt_util.utcnow().isoformat()
                self.history_file.write_text(
                    json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
                    encoding="utf-8",
                )
            return

        records.pop(record_date, None)
        missing_dates = scope.setdefault("missing_dates", {})
        if isinstance(missing_dates, list):
            missing_dates = {str(item): {"reason": reason} for item in missing_dates if item}
            scope["missing_dates"] = missing_dates
        missing_dates[record_date] = {
            "reason": reason,
            "saved_at": dt_util.utcnow().isoformat(),
        }
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()

        self.history_file.write_text(
            json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
            encoding="utf-8",
        )

    def _record_dates_sync(self, scope_key: str) -> set[str]:
        if not self.history_file.exists():
            return set()
        try:
            history = json.loads(self.history_file.read_text(encoding="utf-8"))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
            return set()
        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        records = scope.get("records") or {}
        return {
            str(key)
            for key, reporting in records.items()
            if key and _reporting_has_power_diagram_data(reporting or {})
        }

    def _missing_dates_sync(self, scope_key: str) -> dict[str, dict[str, Any]]:
        if not self.history_file.exists():
            return {}
        try:
            history = json.loads(self.history_file.read_text(encoding="utf-8"))
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Unable to read existing ByteWatt history file: %s", err)
            return {}
        scopes = history.get("scopes") or {}
        scope = scopes.get(scope_key) or {}
        missing = scope.get("missing_dates") or {}
        if isinstance(missing, list):
            return {str(key): {} for key in missing if key}
        if not isinstance(missing, dict):
            return {}
        return {str(key): (value if isinstance(value, dict) else {}) for key, value in missing.items() if key}

    def _write_scope_csv(
        self,
        scope_key: str,
        label: str,
        records: dict[str, Any],
    ) -> None:
        csv_path = self.base_dir / f"{scope_key}.csv"
        fieldnames = [
            "record_date",
            "scope_key",
            "label",
            "aggregate",
            "reporting_date",
            "saved_at",
            "live_soc",
            "live_battery_power",
            "live_load_power",
            "live_grid_power",
            "live_pv_power",
            "power_source",
            "solar_generation_today",
            "load_consumption_today",
            "feed_in_today",
            "grid_consumption_today",
            "battery_charged_today",
            "battery_discharged_today",
            "self_consumption",
            "self_sufficiency",
            "trees_planted",
            "co2_reduction_tons",
            "today_income",
            "total_income",
            "total_solar_generation",
            "total_feed_in",
            "total_battery_charge",
            "total_battery_discharge",
            "total_house_consumption",
            "total_grid_consumption",
            "pv_power_house",
            "pv_charging_battery",
            "grid_battery_charge",
            "chart_time",
            "chart_bat",
            "chart_load",
            "chart_solar",
            "chart_feed_in",
            "chart_consumed",
        ]

        rows: list[dict[str, Any]] = []
        for record_date in sorted(records):
            reporting = records.get(record_date) or {}
            rows.append(
                _summary_row(
                    scope_key=scope_key,
                    label=label,
                    record_date=record_date,
                    reporting=reporting,
                )
            )

        with csv_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: _csv_cell(row.get(key)) for key in fieldnames})
