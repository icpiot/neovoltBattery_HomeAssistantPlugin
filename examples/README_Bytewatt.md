# ByteWatt UI Examples

This folder contains two UI artifacts linked to the current branch work:

- `lovelace/bytewatt_policy_cards.yaml`
  Immediate-use Lovelace YAML using built-in cards.
- `www/bytewatt-policy-card.js`
  A custom card scaffold that mirrors the Byte-Watt mobile app layout more
  closely while keeping unsupported controls visibly marked as not enabled.

## Why Both Exist

The integration backend is only partially modeled today. The confirmed controls
already exposed by the integration can be wired now:

- Settings target selector
- Charge enable
- Discharge enable
- Charge cap
- Discharge cutoff SOC
- Execution cycle
- UPS reserve enable
- Off-grid SOC control
- Charge/discharge times
- Feed-in controls
- Submit / discard buttons

The following app controls still need HAR-backed API work before they become
real entities:

- Any separate Start / Stop master action, if the app uses one

The YAML view gives you a usable interface now. The custom card gives you a
closer replica of the app screen without pretending the missing controls work.

## Recommended Setup

For settings changes, do not use the Byte-Watt web portal's `All` selection.
In parallel-battery systems that path can overwrite shared strategy data in
unpredictable ways.

Recommended approach:

- use `All` only for merged monitoring
- configure settings from the integration's individual battery selector
- prefer a per-battery/host-target setup for charge, discharge, and policy changes

## Installing The Custom Card

Copy `examples/www/bytewatt-policy-card.js` to your Home Assistant `www` folder,
for example:

- `/config/www/bytewatt-policy-card.js`

Then add it as a dashboard resource:

```yaml
url: /local/bytewatt-policy-card.js
type: module
```

## Defaults

The examples now default to the current entity set used in this branch:

- prefix: `house_bytewatt_battery_system`
- submit button: `button.house_bytewatt_battery_system_submit_settings`
- discard button: `button.house_bytewatt_battery_system_discard_pending_settings`

The custom card will use those entities automatically if you do not override
them.

The Lovelace YAML example is also pre-wired to the same entity IDs.

## Optional Overrides

If your entity IDs differ, you can still override them in the custom card.

At a minimum, these battery-policy fields can be overridden:

- `entity_prefix`
- `settings_target`
- `charge_switch`
- `discharge_switch`
- `charge_cap`
- `discharge_cutoff`
- `charge_power`
- `discharge_power`
- `execution_cycle`
- `ups_reserve`
- `offgrid_soc_control`
- `charge_start_time`
- `charge_end_time`
- `discharge_start_time`
- `discharge_end_time`
- `submit_button`
- `discard_button`

Feed-in fields:

- `feedin_enabled`
- `feedin_cutoff`
- `feedin_time_start`
- `feedin_time_end`
- `feedin_power`
- `feedin_submit_button`
- `discard_button`

Optional not-yet-enabled fields:

- `master_action`
