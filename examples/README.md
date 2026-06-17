# ByteWatt UI Examples

This folder contains two UI artifacts linked to the current branch work:

- `lovelace/bytewatt_policy_cards.yaml`
  Immediate-use Lovelace YAML using built-in cards.
- `www/bytewatt-policy-card.js`
  A custom card scaffold that mirrors the Byte-Watt mobile app layout more
  closely while keeping unsupported controls visibly marked as HAR-pending.

## Why Both Exist

The integration backend is only partially modeled today. The confirmed controls
already exposed by the integration can be wired now:

- Charge enable
- Discharge enable
- Charge cap
- Discharge cutoff SOC
- Charge/discharge times
- Feed-in controls
- Submit / discard buttons

The following app controls still need HAR-backed API work before they become
real entities:

- Execution cycle
- UPS reserve enable
- Off-grid SOC control
- Any separate Start / Stop master action, if the app uses one

The YAML view gives you a usable interface now. The custom card gives you a
closer replica of the app screen without pretending the missing controls work.

## Installing The Custom Card

Copy `examples/www/bytewatt-policy-card.js` to your Home Assistant `www` folder,
for example:

- `/config/www/bytewatt-policy-card.js`

Then add it as a dashboard resource:

```yaml
url: /local/bytewatt-policy-card.js
type: module
```

## Entity Mapping

You must replace the example entity ids with your actual ones. The examples use
placeholders because entity ids depend on your device name and HA slugging.

At a minimum, map these:

- `charge_switch`
- `discharge_switch`
- `charge_cap`
- `discharge_cutoff`
- `charge_start_time`
- `charge_end_time`
- `discharge_start_time`
- `discharge_end_time`
- `submit_button`

Feed-in card fields:

- `feedin_enabled`
- `feedin_cutoff`
- `feedin_time_start`
- `feedin_time_end`
- `feedin_power`
- `feedin_submit_button`

Optional HAR-pending placeholders:

- `execution_cycle`
- `ups_reserve`
- `offgrid_soc_control`
- `master_action`
