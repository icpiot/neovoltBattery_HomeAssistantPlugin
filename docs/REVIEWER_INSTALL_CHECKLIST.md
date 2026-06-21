# Reviewer Install Checklist

Use this when handing the branch to another reviewer or the upstream owner.

## 1. Integration only

Install through HACS custom repository or copy:

- `custom_components/bytewatt`

Then in Home Assistant:

1. restart Home Assistant
2. go to Settings -> Devices & Services
3. Add Integration
4. search for `Byte-Watt Battery Monitor`

## 2. Confirm baseline behavior

Check:

- login succeeds
- entities load without config flow errors
- monitoring values update
- multi-inverter accounts can select the host inverter
- no obvious entity duplication/regression

## 3. Policy workflow checks

Verify:

- charge/discharge/feed-in values can be staged
- `Submit Settings` pushes pending changes
- `Discard Pending Settings` clears pending changes
- values survive a failed submit and can be retried
- off-grid SOC control values appear where supported

## 4. Optional card install

Only if reviewing the optional frontend work.

Copy:

- `examples/www/bytewatt-policy-card.js`
- `examples/www/bytewatt-report-card.js`

Add Lovelace resources:

```yaml
url: /local/community/bytewatt-card/bytewatt-policy-card.js?v=048
type: module
```

```yaml
url: /local/community/bytewatt-card/bytewatt-report-card.js?v=008
type: module
```

## 5. Optional card checks

Policy card:

- per-battery selection works
- `All systems` behavior is restricted where needed
- pending edits are visible
- charge/discharge/feed-in sections render correctly
- off-grid section only appears when supported

Reporting card:

- summary tiles render
- all-systems comparison renders for aggregate selection
- per-battery selection changes the displayed context
- power diagram renders
- CSV export works

## 6. What is optional vs required

Required for integration review:

- `custom_components/bytewatt`

Optional:

- `examples/`
- `frontend/`

The integration should remain installable and usable without any custom cards.
