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
    return {
        "aggregate": aggregate,
        "label": label,
        "meta": {
            "aggregate": aggregate,
            "label": label,
            "saved_at": dt_util.utcnow().isoformat(),
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
            "solar_generation": battery_data.get("Total_Solar_Generation"),
            "feed_in": battery_data.get("Total_Feed_In"),
            "battery_charge": battery_data.get("Total_Battery_Charge"),
            "battery_discharge": battery_data.get("Total_Battery_Discharge"),
            "house_consumption": battery_data.get("Total_House_Consumption"),
            "grid_consumption": battery_data.get("Grid_Power_Consumption"),
            "pv_power_house": battery_data.get("PV_Power_House"),
            "pv_charging_battery": battery_data.get("PV_Charging_Battery"),
            "grid_battery_charge": battery_data.get("Grid_Based_Battery_Charge"),
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
    power_diagram = reporting.get("power_diagram") or {}
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

    def _store_snapshot_sync(
        self,
        scope_key: str,
        label: str,
        record_date: str,
        reporting: dict[str, Any],
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
            },
        )
        scope["label"] = label
        scope["updated"] = dt_util.utcnow().isoformat()
        records = scope.setdefault("records", {})
        records[record_date] = reporting
        history["version"] = 1
        history["updated"] = dt_util.utcnow().isoformat()

        self.history_file.write_text(
            json.dumps(history, indent=2, ensure_ascii=False, default=_json_default),
            encoding="utf-8",
        )
        self._write_scope_csv(scope_key, label, scope.get("records", {}))

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

