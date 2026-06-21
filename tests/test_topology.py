"""Tests for aggregate vs per-battery topology helpers."""
from __future__ import annotations

import importlib.util
import os
import sys


def _load_topology_module():
    here = os.path.dirname(__file__)
    path = os.path.abspath(os.path.join(
        here, "..", "custom_components", "bytewatt", "topology.py",
    ))
    spec = importlib.util.spec_from_file_location("bytewatt_topology", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


topology = _load_topology_module()
ByteWattScope = topology.ByteWattScope
DiscoveredInverter = topology.DiscoveredInverter
StrategyFieldScope = topology.StrategyFieldScope
strategy_field_scope = topology.strategy_field_scope


def test_aggregate_scope_uses_all_sys_sn():
    scope = ByteWattScope.aggregate_scope()
    assert scope.aggregate is True
    assert scope.effective_sys_sn == "All"
    assert scope.label == "All systems"


def test_discovered_inverter_parses_known_fields():
    inv = DiscoveredInverter.from_api_response({
        "systemId": "sys-1",
        "sysSn": "SN-1",
        "stationId": "station-1",
        "remark": "Host battery",
        "deviceId": "device-1",
        "batteryId": "battery-1",
    })
    assert inv.system_id == "sys-1"
    assert inv.sys_sn == "SN-1"
    assert inv.station_id == "station-1"
    assert inv.device_id == "device-1"
    assert inv.battery_id == "battery-1"
    assert inv.is_host_candidate is True


def test_discovered_inverter_display_name_prefers_remark():
    inv = DiscoveredInverter.from_api_response({
        "systemId": "sys-1",
        "sysSn": "SN-1",
        "remark": "Battery A",
    })
    assert inv.display_name == "SN-1 (Battery A)"


def test_discovered_inverter_maps_to_settings_scope():
    inv = DiscoveredInverter.from_api_response({
        "systemId": "sys-1",
        "sysSn": "SN-1",
        "stationId": "station-1",
        "deviceId": "device-1",
        "batteryId": "battery-1",
    })
    scope = inv.to_settings_scope()
    assert scope.aggregate is False
    assert scope.effective_system_id == "sys-1"
    assert scope.effective_sys_sn == "SN-1"
    assert scope.device_id == "device-1"
    assert scope.battery_id == "battery-1"


def test_strategy_field_scope_matches_har_observations():
    assert strategy_field_scope("charge_power") is StrategyFieldScope.SHARED
    assert strategy_field_scope("grid_charging") is StrategyFieldScope.PER_BATTERY
    assert strategy_field_scope("charge_cap") is StrategyFieldScope.PER_BATTERY
    assert strategy_field_scope("poinv") is StrategyFieldScope.HYBRID
    assert strategy_field_scope("unknown_field") is StrategyFieldScope.UNKNOWN
