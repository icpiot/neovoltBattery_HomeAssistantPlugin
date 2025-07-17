# Byte-Watt Battery Monitor Integration for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)

This integration allows you to monitor and control your Byte-Watt battery system through Home Assistant.

## Features

- **Battery Monitoring**:
  - Battery percentage
  - Power flow (grid, house, battery, PV)
  - Energy statistics

- **Battery Control**:
  - Set charge times (start/end)
  - Set discharge times (start/end)
  - Set minimum battery SOC

## Installation

### HACS Installation (Recommended)

1. Make sure you have [HACS](https://hacs.xyz/) installed
2. Add this repository as a custom repository in HACS:
   - Go to HACS → Integrations
   - Click the three dots in the top right corner
   - Select "Custom repositories"
   - Add the URL of this repository
   - Category: Integration
3. Click "Install" on the Byte-Watt Battery Monitor integration
4. Restart Home Assistant
5. Add the integration:
   - Go to Configuration → Integrations
   - Click "Add Integration"
   - Search for "Byte-Watt Battery Monitor"

### Manual Installation

1. Copy the `custom_components/bytewatt` directory to your Home Assistant `custom_components` directory
2. Restart Home Assistant
3. Add the integration through Configuration → Integrations

## Configuration

During setup, you'll need to provide:
- Username (email)
- Password
- Update interval (minimum 30 seconds)

## Services

The integration provides several services for controlling your battery:

- `bytewatt.set_discharge_start_time`: Set when battery discharge begins
- `bytewatt.set_discharge_time`: Set when battery discharge ends
- `bytewatt.set_charge_start_time`: Set when battery charging begins  
- `bytewatt.set_charge_end_time`: Set when battery charging ends
- `bytewatt.set_minimum_soc`: Set the minimum battery level to maintain
- `bytewatt.update_battery_settings`: Update multiple settings at once

## Example Automations

```yaml
# Set different battery settings based on electricity prices
automation:
  - alias: "Peak Price Battery Settings"
    trigger:
      platform: state
      entity_id: sensor.electricity_price_tier
      to: 'peak'
    action:
      service: bytewatt.update_battery_settings
      data:
        start_discharge: "17:00"
        end_discharge: "22:00" 
        minimum_soc: 20
        
  - alias: "Off-Peak Charging"
    trigger:
      platform: state
      entity_id: sensor.electricity_price_tier
      to: 'off_peak'
    action:
      service: bytewatt.update_battery_settings
      data:
        start_charge: "01:00"
        end_charge: "05:00"
```

## Troubleshooting

- **Network Errors**: The integration has retry logic built-in to handle temporary network issues with the Byte-Watt API
- **Time Format Issues**: The integration automatically handles various time formats and normalizes them to HH:MM
- **Battery Data Sensors**: The integration maps API fields as follows:
  - **Real-time metrics**:
    - `pgrid` → Grid Consumption (W)
    - `pload` → House Consumption (W)
    - `pbat` → Battery Power (W)
    - `ppv` → PV Power (W)
    - `soc` → Battery Percentage (%)
  
  - **Energy statistics metrics**:
    - `epvT` → Total Solar Generation (kWh)
    - `eout` → Total Feed In (kWh)
    - `echarge` → Total Battery Charge (kWh)
    - `epv2load` → PV Power to House (kWh)
    - `epvcharge` → PV Charging Battery (kWh)
    - `eload` → Total House Consumption (kWh)
    - `egridCharge` → Grid Based Battery Charge (kWh)
    - `einput` → Grid Power Consumption (kWh)
  
  If you're experiencing issues with certain sensors not showing data, you can enable debug logging to see the available data fields from the API.

## Support

For issues, feature requests, or questions, please open an issue on GitHub.

## Credits

This integration was created with the help of the Home Assistant community and Claude AI.

---

## 🚧 This Fork — Custom Enhancements by icpiot

This fork builds on the original ByteWatt Home Assistant integration with these key additions:

- ✅ Added support for toggling **Enable Grid Charging** via API (`grid_charge` and `enableGridCharging` fields)
- ✅ Full support for battery scheduling fields:
  - Charge start/end times (`time_chaf1a`, `time_chae1a`)
  - Discharge start/end times (`time_disf1a`, `time_dise1a`)
  - Minimum and maximum State of Charge (`bat_use_cap`, `bat_high_cap`)
- ✅ Added Home Assistant `input_boolean.bytewatt_enable_grid_charging` for dashboard toggle
- ✅ Implemented sync helpers to keep HA toggle and ByteWatt API in harmony
- ✅ Validated and sanitized all relevant time and SOC input parameters
- 🔄 Upcoming: Full syncing of **Enable Grid Charging Battery** and **Enable Battery Discharge Time Control** with Home Assistant

Special thanks to ChatGPT (OpenAI) for code brainstorming and assistance.

⚠️ **Note:** This fork is actively developed and may differ from the official integration. Use responsibly.

---

For original project details, visit:  
[candreacchio/neovoltBattery_HomeAssistantPlugin](https://github.com/candreacchio/neovoltBattery_HomeAssistantPlugin)
