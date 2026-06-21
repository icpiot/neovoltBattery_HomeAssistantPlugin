"""Topology helpers for aggregate vs per-battery Byte-Watt access.

The current integration still operates mostly in a single-host mode for
settings, but dual-battery installs need two distinct concepts:

1. Aggregate monitoring scope (`sysSn=All`) for merged overview sensors.
2. Battery-specific settings scopes for the per-battery policy screens.

This module defines small, dependency-free dataclasses so config flow,
migration, and future HAR-derived per-battery work can share one shape.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class StrategyFieldScope(str, Enum):
    """Observed backend scope for a cycle-strategy field.

    The Byte-Watt cloud does not behave like a clean "all fields are shared"
    or "all fields are per-battery" API. HAR captures from dual-inverter
    systems show a hybrid model, so we keep the observed scope close to the
    topology helpers for future entity/config work.
    """

    AGGREGATE = "aggregate"
    PER_BATTERY = "per_battery"
    SHARED = "shared"
    HYBRID = "hybrid"
    UNKNOWN = "unknown"


FIELD_SCOPE_OVERRIDES: dict[str, StrategyFieldScope] = {
    # Confirmed from HARs: changing chargePower on one inverter propagates
    # into the shared/ALL strategy view even without an ALL save.
    "charge_power": StrategyFieldScope.SHARED,
    # Confirmed from HARs: these continue to differ by selected battery view.
    "grid_charging": StrategyFieldScope.PER_BATTERY,
    "charge_cap": StrategyFieldScope.PER_BATTERY,
    # The backend-derived power ceiling flips between 10 kW and 5 kW and is
    # used for whole-payload validation, so treat it as hybrid/unstable.
    "poinv": StrategyFieldScope.HYBRID,
}


def strategy_field_scope(field_name: str) -> StrategyFieldScope:
    """Return the best-known backend scope for a logical settings field."""
    return FIELD_SCOPE_OVERRIDES.get(field_name, StrategyFieldScope.UNKNOWN)


@dataclass(frozen=True)
class ByteWattScope:
    """A concrete API scope for either aggregate or per-battery calls."""

    system_id: str = ""
    sys_sn: str = ""
    station_id: str = ""
    label: str = ""
    aggregate: bool = False
    # Placeholder identifiers for future HAR-derived battery targeting.
    device_id: str = ""
    battery_id: str = ""
    settings_system_id: str = ""
    settings_sys_sn: str = ""

    @classmethod
    def aggregate_scope(cls, station_id: str = "") -> "ByteWattScope":
        return cls(
            sys_sn="All",
            station_id=station_id,
            label="All systems",
            aggregate=True,
        )

    @property
    def effective_sys_sn(self) -> str:
        """Return the sysSn value expected by monitoring endpoints."""
        if self.aggregate:
            return "All"
        return self.settings_sys_sn or self.sys_sn

    @property
    def effective_system_id(self) -> str:
        """Return the best system identifier for settings endpoints."""
        return self.settings_system_id or self.system_id


@dataclass(frozen=True)
class DiscoveredInverter:
    """Structured representation of an inverter/battery entry from the API."""

    system_id: str = ""
    sys_sn: str = ""
    station_id: str = ""
    remark: str = ""
    device_id: str = ""
    battery_id: str = ""
    raw_data: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_api_response(cls, data: dict[str, Any]) -> "DiscoveredInverter":
        return cls(
            system_id=str(data.get("systemId") or ""),
            sys_sn=str(data.get("sysSn") or ""),
            station_id=str(data.get("stationId") or ""),
            remark=str(data.get("remark") or ""),
            device_id=str(data.get("deviceId") or ""),
            battery_id=str(data.get("batteryId") or ""),
            raw_data=dict(data),
        )

    @property
    def display_name(self) -> str:
        label = self.sys_sn or self.system_id or "Unknown inverter"
        return f"{label} ({self.remark})" if self.remark else label

    @property
    def is_host_candidate(self) -> bool:
        remark = self.remark.lower()
        return "master" in remark or "host" in remark

    def to_settings_scope(self) -> ByteWattScope:
        """Map the discovered record to a future settings target."""
        return ByteWattScope(
            system_id=self.system_id,
            sys_sn=self.sys_sn,
            station_id=self.station_id,
            label=self.display_name,
            aggregate=False,
            device_id=self.device_id,
            battery_id=self.battery_id,
            settings_system_id=self.system_id,
            settings_sys_sn=self.sys_sn,
        )
