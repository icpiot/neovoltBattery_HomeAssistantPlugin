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
from .topology import ByteWattScope, DiscoveredInverter

_CYCLE_OPTIONS = ["Daily", "Weekly"]


def _reporting_payload(
    battery_data: dict[str, Any],
    *,
    aggregate: bool,
    label: str,
) -> dict[str, Any]:
    """Build a compact reporting payload for custom Lovelace cards."""
    power_diagram = battery_data.get("Power_Diagram") or {}
    return {
        "aggregate": aggregate,
        "label": label,
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
        labels = list(self._options_map())
        if len(labels) > 1:
            return ["All systems", *labels]
        return labels

    @property
    def available(self) -> bool:
        return bool(self.options)

    @property
    def current_option(self) -> str | None:
        current_id = self._manager.current_settings_target_id
        if not current_id and len(self.options) > 1:
            return "All systems"
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
        coordinator_data = self.coordinator.data or {}
        aggregate_battery = coordinator_data.get("battery") or {}
        selected_battery = coordinator_data.get("selected_battery") or {}
        all_batteries = coordinator_data.get("all_batteries") or {}
        monitoring_summary = {
            "soc": selected_battery.get("soc") if current is not None else aggregate_battery.get("soc"),
            "battery_power": selected_battery.get("pbat") if current is not None else aggregate_battery.get("pbat"),
            "house_consumption": selected_battery.get("pload") if current is not None else aggregate_battery.get("pload"),
            "grid_power": selected_battery.get("pgrid") if current is not None else aggregate_battery.get("pgrid"),
            "pv_power": selected_battery.get("ppv") if current is not None else aggregate_battery.get("ppv"),
            "power_source": selected_battery.get("powerSource") if current is not None else aggregate_battery.get("powerSource"),
        }
        all_system_summaries = []
        if current is None:
            seen_sys_sn: set[str] = set()
            for inverter in self._inventory():
                sys_sn = str(inverter.sys_sn or "").strip()
                if not sys_sn or sys_sn in seen_sys_sn:
                    continue
                seen_sys_sn.add(sys_sn)
                battery_data = all_batteries.get(sys_sn) or {}
                all_system_summaries.append(
                    {
                        "label": inverter.display_name,
                        "system_id": inverter.system_id,
                        "sys_sn": inverter.sys_sn,
                        "remark": inverter.remark,
                        "soc": battery_data.get("soc"),
                        "battery_power": battery_data.get("pbat"),
                        "house_consumption": battery_data.get("pload"),
                        "grid_power": battery_data.get("pgrid"),
                        "pv_power": battery_data.get("ppv"),
                        "power_source": battery_data.get("powerSource"),
                    }
                )
        if current is None:
            return {
                "monitoring_summary": monitoring_summary,
                "all_system_summaries": all_system_summaries,
                "reporting": _reporting_payload(
                    aggregate_battery,
                    aggregate=True,
                    label="All systems",
                ),
                "battery_policy": self._manager.battery_policy_summary(),
                "feedin_policy": self._manager.feedin_policy_summary(),
            }
        return {
            "system_id": current.system_id,
            "sys_sn": current.sys_sn,
            "remark": current.remark,
            "monitoring_summary": monitoring_summary,
            "reporting": _reporting_payload(
                selected_battery,
                aggregate=False,
                label=current.display_name,
            ),
            "battery_policy": self._manager.battery_policy_summary(),
            "feedin_policy": self._manager.feedin_policy_summary(),
        }

    async def async_select_option(self, option: str) -> None:
        if option == "All systems":
            scope = ByteWattScope(
                system_id="",
                sys_sn="All",
                label="All systems",
                aggregate=True,
                settings_system_id="",
                settings_sys_sn="",
            )
            await self._manager.async_select_settings_target(scope)
            self.hass.data[DOMAIN][self._config_entry.entry_id]["settings_scope"] = scope
            await self.coordinator.async_request_refresh()
            self.async_write_ha_state()
            return
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
