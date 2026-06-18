"""Select entities for the Byte-Watt integration."""
from __future__ import annotations

from typing import Any

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import ByteWattDataUpdateCoordinator
from .settings_manager import SettingsManager
from .topology import DiscoveredInverter

_CYCLE_OPTIONS = ["Daily", "Weekly"]


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator = hass.data[DOMAIN][config_entry.entry_id]["coordinator"]
    manager = hass.data[DOMAIN][config_entry.entry_id]["manager"]

    async_add_entities([
        ByteWattSettingsTargetSelect(hass, coordinator, config_entry, manager),
        ByteWattExecutionCycleSelect(coordinator, config_entry, manager),
    ])


class ByteWattSettingsTargetSelect(CoordinatorEntity, SelectEntity):
    """Select which discovered battery/inverter receives settings writes."""

    _attr_entity_category = EntityCategory.CONFIG

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: ByteWattDataUpdateCoordinator,
        config_entry: ConfigEntry,
        manager: SettingsManager,
    ) -> None:
        super().__init__(coordinator)
        self.hass = hass
        self._config_entry = config_entry
        self._manager = manager
        self._attr_name = "Settings Target"
        self._attr_unique_id = f"{config_entry.entry_id}_settings_target"
        self._attr_icon = "mdi:battery-switch"

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": "ByteWatt Battery System",
            "manufacturer": "ByteWatt",
            "model": "Battery Management System",
        }

    def _inventory(self) -> list[DiscoveredInverter]:
        inventory = self.hass.data[DOMAIN][self._config_entry.entry_id].get("inverters", [])
        if inventory:
            return inventory
        current_id = self._manager.current_settings_target_id
        current_sys_sn = self._manager.current_settings_target_sys_sn
        if current_id or current_sys_sn:
            return [DiscoveredInverter(system_id=current_id, sys_sn=current_sys_sn)]
        return []

    def _options_map(self) -> dict[str, DiscoveredInverter]:
        options: dict[str, DiscoveredInverter] = {}
        used_labels: set[str] = set()
        for inverter in self._inventory():
            label = inverter.display_name
            if label in used_labels:
                label = f"{label} [{inverter.system_id or inverter.sys_sn}]"
            used_labels.add(label)
            options[label] = inverter
        return options

    @property
    def options(self) -> list[str]:
        return list(self._options_map())

    @property
    def available(self) -> bool:
        return bool(self.options)

    @property
    def current_option(self) -> str | None:
        current_id = self._manager.current_settings_target_id
        for label, inverter in self._options_map().items():
            if inverter.system_id == current_id:
                return label
        return self.options[0] if self.options else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        current_id = self._manager.current_settings_target_id
        current = next(
            (inverter for inverter in self._inventory() if inverter.system_id == current_id),
            None,
        )
        if current is None:
            return {}
        return {
            "system_id": current.system_id,
            "sys_sn": current.sys_sn,
            "remark": current.remark,
        }

    async def async_select_option(self, option: str) -> None:
        inverter = self._options_map().get(option)
        if inverter is None:
            raise HomeAssistantError(f"Unknown settings target: {option}")

        await self._manager.async_select_settings_target(inverter.to_settings_scope())
        self.hass.data[DOMAIN][self._config_entry.entry_id]["settings_scope"] = (
            inverter.to_settings_scope()
        )
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()


class ByteWattExecutionCycleSelect(CoordinatorEntity, SelectEntity):
    """Select entity for the cycle strategy execution mode."""

    _attr_entity_category = EntityCategory.CONFIG
    _attr_options = _CYCLE_OPTIONS

    def __init__(
        self,
        coordinator: ByteWattDataUpdateCoordinator,
        config_entry: ConfigEntry,
        manager: SettingsManager,
    ) -> None:
        super().__init__(coordinator)
        self._config_entry = config_entry
        self._manager = manager
        self._attr_name = "Execution Cycle"
        self._attr_unique_id = f"{config_entry.entry_id}_execution_cycle_type"
        self._attr_icon = "mdi:calendar-sync"

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._config_entry.entry_id)},
            "name": "ByteWatt Battery System",
            "manufacturer": "ByteWatt",
            "model": "Battery Management System",
        }

    @property
    def available(self) -> bool:
        return self._manager.battery_cache is not None

    @property
    def current_option(self) -> str | None:
        value = self._manager.effective_battery("execution_cycle_type")
        if value is None:
            return None
        return _CYCLE_OPTIONS[int(value)] if int(value) in (0, 1) else None

    async def async_select_option(self, option: str) -> None:
        value = 0 if option == "Daily" else 1
        result = await self._manager.submit_battery_one_shot(
            {"execution_cycle_type": value}
        )
        if not result.battery_ok:
            detail = result.battery_error or "see logs for details"
            raise HomeAssistantError(f"Battery settings update failed: {detail}")
        await self.coordinator.async_request_refresh()
        self.async_write_ha_state()
