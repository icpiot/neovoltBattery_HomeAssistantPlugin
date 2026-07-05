"""High-level client wrapper for the Byte-Watt integration."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from homeassistant.core import HomeAssistant

from .api.neovolt_client import NeovoltClient
from .topology import ByteWattScope, DiscoveredInverter

_LOGGER = logging.getLogger(__name__)


class ByteWattClient:
    """Thin wrapper exposing the low-level API client and inverter metadata.

    Settings reads/writes go through SettingsManager (in settings_manager.py),
    not through this class — historical per-setting methods have been removed.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        username: str,
        password: str,
        host_system_id: str = "",
        host_sys_sn: str = "",
    ) -> None:
        self.hass = hass
        self.username = username
        self.password = password
        self.api_client = NeovoltClient(
            hass, username, password,
            host_system_id=host_system_id,
            host_sys_sn=host_sys_sn,
        )

    async def initialize(self) -> bool:
        """Authenticate against the Byte-Watt API."""
        return await self.api_client.async_login()

    async def get_battery_data(
        self,
        station_id: Optional[str] = None,
        sys_sn: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Poll the real-time + cumulative battery data endpoints.

        Raises ``ByteWattAPIError`` on failure — the caller (coordinator)
        relies on this so its circuit-breaker accounting sees real failures
        instead of silently treating None as success.
        """
        return await self.api_client.async_get_battery_data(station_id, sys_sn=sys_sn)

    async def get_battery_day_snapshot(
        self,
        report_date: str,
        station_id: Optional[str] = None,
        sys_sn: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch a daily reporting snapshot for a specific date."""
        return await self.api_client.async_get_battery_day_snapshot(
            report_date,
            station_id=station_id,
            sys_sn=sys_sn,
        )

    async def get_device_list(self) -> Optional[Dict[str, Any]]:
        return await self.api_client.async_get_device_list()

    def aggregate_scope(self, station_id: str = "") -> ByteWattScope:
        """Return the merged monitoring scope used for aggregate sensors."""
        return ByteWattScope.aggregate_scope(station_id)

    def selected_settings_scope(self) -> ByteWattScope:
        """Return the currently selected settings target.

        This still maps to the single configured host inverter today, but it
        gives future per-battery work one stable place to extend once HAR
        captures reveal the remaining identifiers.
        """
        return ByteWattScope(
            system_id=self.api_client.host_system_id,
            sys_sn=self.api_client.host_sys_sn,
            label=self.api_client.host_sys_sn or self.api_client.host_system_id,
            aggregate=False,
            settings_system_id=self.api_client.host_system_id,
            settings_sys_sn=self.api_client.host_sys_sn,
        )

    async def fetch_inverter_list(self) -> list:
        """List the inverters on this account (config flow / migration use)."""
        return await self.api_client.fetch_inverter_list()

    async def fetch_inverter_inventory(self) -> list[DiscoveredInverter]:
        """Return structured inverter records for config and future topology work."""
        return [
            DiscoveredInverter.from_api_response(item)
            for item in await self.fetch_inverter_list()
        ]
