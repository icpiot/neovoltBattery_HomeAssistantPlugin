# Upstream PR Draft

## Title

Harden HA compatibility, add staged policy controls, and expand optional UI examples

## Summary

This branch packages a large Byte-Watt / Neovolt integration hardening pass
focused on Home Assistant compatibility, staged settings writes, multi-battery
policy control, and richer optional UI examples.

The core integration changes stay within `custom_components/bytewatt`.
Optional Lovelace/frontend work remains separate and can be reviewed
independently.

## What changed

### Integration

- hardened staged settings behavior around charge, discharge, feed-in, and
  off-grid policy values
- expanded per-battery policy handling for multi-inverter and multi-battery
  setups
- added off-grid wake-up SOC and off-grid cut-off SOC support
- refreshed HACS-facing metadata and install docs
- kept the integration install path as the primary supported path

### Optional cards and examples

- expanded the policy card significantly to better match the Byte-Watt app flow
- added a reporting card for:
  - live summary data
  - all-systems comparison
  - power diagram
  - statistical summaries
  - CSV export
- preserved example/archive card builds under `examples/www/`
- added a frontend package scaffold under `frontend/bytewatt-card/` so the
  optional cards can later be split into a standalone HACS dashboard repo

## Why this helps

- improves day-to-day usability for users with more than one battery/inverter
- reduces API write problems by leaning on staged commit behavior
- exposes more real settings and monitoring information already present in the
  portal/app
- gives users an optional richer dashboard path without forcing custom cards on
  anyone using only the integration

## Suggested review scope

To keep review manageable, I would suggest splitting discussion into three areas:

1. `custom_components/bytewatt`
   - runtime behavior
   - entity model
   - settings manager changes
   - HA compatibility
2. `examples/`
   - optional Lovelace examples
   - policy/reporting cards
3. `frontend/bytewatt-card/`
   - scaffolding only
   - future standalone frontend package

## Installation notes for reviewers

### Integration

Install as usual through HACS custom repository or by copying:

- `custom_components/bytewatt`

### Optional cards

The optional cards are not required for integration testing.

If a reviewer wants them:

- copy `examples/www/bytewatt-policy-card.js`
- copy `examples/www/bytewatt-report-card.js`

Add Lovelace resources:

```yaml
url: /local/community/bytewatt-card/bytewatt-policy-card.js?v=048
type: module
```

```yaml
url: /local/community/bytewatt-card/bytewatt-report-card.js?v=008
type: module
```

## Notes

- the frontend scaffold in `frontend/bytewatt-card/` is included for future
  packaging work, not because HACS can install both integration and dashboard
  assets from the same repo at once
- if preferred, the optional frontend package can be split into a second repo
  and reviewed separately

Supporting handoff docs:

- `docs/UPSTREAM_SPLIT_PLAN.md`
- `docs/REVIEWER_INSTALL_CHECKLIST.md`
