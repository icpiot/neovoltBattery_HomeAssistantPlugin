# Byte-Watt Battery Monitor Integration for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/custom-components/hacs)

Monitor and control a Byte-Watt / Neovolt battery system from Home Assistant.

Requires Home Assistant **2024.11.0** or later.

## Features

- **Real-time monitoring** - SOC, grid / house / PV / battery power flows
- **Cumulative + today's energy** - solar generation, feed-in, grid import, charge / discharge
- **Battery control** - charge / discharge time windows, minimum SOC, charge cap,
  per-slot charge and discharge power, grid charging on/off, discharge time control on/off
- **Grid Feed-in Control** - enable/disable, cutoff SOC, Time Period 1 start/end/power
- **Staged-edit workflow** - UI changes accumulate in a pending store and are
  pushed to the inverter in one shot via the **Submit Settings** button. A
  **Discard Pending Settings** button drops them.
- **Multi-inverter support** - pick which inverter is the Host during setup, change
  it later via Configure (no need to delete and re-add)
- **Automatic recovery** - heartbeat monitoring, circuit breaker, auto-reconnect
- **Optional dashboard cards** - policy and reporting cards are included in
  this repo for users who want a richer Lovelace UI

## Installation

### HACS (recommended)

1. Install [HACS](https://hacs.xyz/) if you haven't already.
2. HACS -> Integrations -> menu -> Custom repositories -> add this repo URL -> Category: Integration.
3. Install **Byte-Watt Battery Monitor** and restart Home Assistant.
4. Settings -> Devices & Services -> Add Integration -> search for **Byte-Watt Battery Monitor**.

### Manual

Copy `custom_components/bytewatt` into your Home Assistant `custom_components/`
directory, restart, then add the integration as above.

### Repo-managed HA pull/push

This branch now includes repo-owned HA helper scripts under [scripts](scripts):

- `scripts/ha_git_pull.sh`
- `scripts/ha_git_push.sh`
- `scripts/neovolt_git_pull.sh`
- `scripts/neovolt_git_push.sh`

Use these as the canonical versions for Home Assistant shell commands. If your
existing HA flow already runs `neovolt_git_pull.sh`, keep that filename and copy
the matching script from the repo. The pull script is designed to deploy both:

- `custom_components/bytewatt`
- `examples/www/bytewatt-policy-card.js`
- `examples/www/bytewatt-report-card.js`

That avoids the broken state where the frontend card is newer than the backend
integration logic.

## Setup

You'll be asked for:

- **Username** (your Byte-Watt portal email)
- **Password**
- **Scan interval** - 30 s minimum (default 60 s)

If the account has more than one inverter, a second step asks you to pick the
**Host inverter**. Single-inverter accounts skip that step automatically.

To change which inverter is the Host later: Settings -> Devices & Services ->
Byte-Watt -> menu -> Reconfigure.

## Entities

| Platform | Entities |
|---|---|
| `sensor` | 30+ sensors covering real-time power, today's energy, cumulative totals, environmental stats |
| `switch` | Grid Charging Battery, Battery Discharge Time Control, Grid Feed-in Function, Off-grid SOC Control |
| `number` | Minimum SOC, Battery Charge Cap, Battery Charge Power, Battery Discharge Power, Grid Feed-in Cutoff SOC, Grid Feed-in Time1 Power, Off-grid Wake-up SOC, Off-grid Cut-off SOC |
| `time`   | Charge Start/End, Discharge Start/End, Grid Feed-in Time1 Start/End |
| `button` | **Submit Settings**, **Discard Pending Settings** |
| `select` | Settings Target, Execution Cycle |

### Submit/Discard workflow

Changing a switch / number / time entity **does not** immediately write to the
inverter. The change is held locally and shown on the entity. Press
**Submit Settings** to push everything pending in one transaction. Press
**Discard Pending Settings** to drop staged changes and revert entities to the
inverter's current state.

On a successful submit, a persistent notification confirms. On a failure, the
notification explains which batch failed and why, and the pending changes are
**preserved** so you can fix the issue and press Submit again.

## Services

The legacy "set this one thing" services still work - they stage the change
and submit immediately:

- `bytewatt.set_minimum_soc` - set minimum battery SOC (1-100 %)
- `bytewatt.set_charge_cap` - set charge cap (1-100 %)
- `bytewatt.set_discharge_start_time` / `set_discharge_time` - discharge window
- `bytewatt.set_charge_start_time` / `set_charge_end_time` - charge window
- `bytewatt.update_battery_settings` - set any combination in one call

Grid Feed-in:

- `bytewatt.set_grid_feedin_enabled` - toggle Grid Feed-in Function on/off
- `bytewatt.set_grid_feedin_cutoff_soc` - set discharging cutoff SOC (0-100 %)
- `bytewatt.update_grid_feedin_slot` - set start/end/power for slot 1-6

Maintenance:

- `bytewatt.force_reconnect` - drop the session and re-authenticate
- `bytewatt.health_check` - run network + auth + API diagnostics
- `bytewatt.toggle_diagnostics` - verbose API logging on/off

All services accept an optional `entry_id` field. If you have a single
Byte-Watt account configured you can omit it; with multiple accounts it's
required.

## Configuration options

After install, Settings -> Devices & Services -> Byte-Watt -> Configure:

- **Scan interval** (seconds) - minimum 30, default 60
- **Host inverter** - choose the device used for shared policy operations when
  the account has multiple inverters
- **History backfill horizon** (years) - how far back the integration is
  allowed to build local daily history, default `1`

## Historical Data Workflow

Historical reporting is automatic. Users do not manually trigger downloads.

The expected flow is:

1. Install and configure the integration.
2. Set the **History backfill horizon** in options.
3. Leave Home Assistant running so the integration can backfill daily rows in
   the background.
4. Open the report card and choose:
   - battery scope
   - period
   - date
5. The card uses local history when it exists.
6. If a selected day is missing, the card asks the backend to fetch it.
7. If the upstream service has no data for a date, the UI says so plainly
   instead of retrying forever.

Key behavior:

- Data is stored per scope, so `All systems` and each battery keep their own
  archive.
- A date only needs to download once. Later visits should reuse the saved
  local archive.
- The date picker clamps to today. Future dates are not queried.
- `Today` uses live reporting and does not force archive backfill.

## Troubleshooting

- **A repair issue says "Host inverter not configured"** - you have more than
  one inverter on the account and no Host has been selected. Reconfigure
  (Settings -> Devices & Services -> Byte-Watt -> menu -> Reconfigure) and pick one.
- **Submit button shows partial failure** - the notification names which
  batch failed and the error reason. Your unsaved changes are kept; fix and
  submit again.
- **Entity shows "unavailable"** - the integration hasn't yet fetched the
  relevant settings from the API. Usually transient; check logs if it persists.

## UI Examples

This repo also includes example dashboard assets under [examples](examples):

- `examples/lovelace/bytewatt_policy_cards.yaml`
- `examples/lovelace/bytewatt_report_card.yaml`
- `examples/www/bytewatt-policy-card.js`
- `examples/www/bytewatt-report-card.js`

The optional custom cards are not auto-installed by HACS with the integration.
If you want them, copy the files above into Home Assistant's `www` folder and
add them as Lovelace resources.

If you are using the repo-managed HA pull script, the pull should deploy both
the custom cards and the integration backend together.

A future standalone frontend-package scaffold for these cards now lives under:

- `frontend/bytewatt-card/`

Current resource URLs used by this branch:

```yaml
url: /local/community/bytewatt-card/bytewatt-policy-card.js?v=048
type: module
```

```yaml
url: /local/community/bytewatt-card/bytewatt-report-card.js?v=167
type: module
```

## Support

Open an issue at [icpiot/neovoltBattery_HomeAssistantPlugin/issues](https://github.com/icpiot/neovoltBattery_HomeAssistantPlugin/issues).

## Credits

Originally built with the Home Assistant community and Claude AI. Subsequent
contributors are credited in the commit history.
