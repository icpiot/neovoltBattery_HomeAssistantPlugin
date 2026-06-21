# Upstream Split Plan

Base synced commit:

- `8748fb15e1278131d0b9807405c13190864c1db9`

This branch grew in two directions at once:

1. core integration/runtime hardening
2. optional frontend/dashboard work

For upstream review, those should not be sent as one giant PR.

## Recommended split

### PR 1: Integration hardening only

Goal:

- get the runtime and Home Assistant behavior merged first

Primary areas:

- `custom_components/bytewatt/`
- root metadata/docs that directly describe the integration

Commits most closely aligned with this:

- `b47dda7` fix: harden HA 2026 compatibility and auth flow
- `a47b525` fix: make control entities submit immediately
- `1ff819b` refactor: scaffold aggregate and battery scopes
- `9e74c3d` fix: harden hybrid parallel battery settings
- `477a5b0` fix: mark daily energy sensors as totals
- `45f34b1` fix: rename legacy total discharge entity
- `d22c1d8` Refresh HACS packaging metadata and install docs

Also review any related changes included in:

- `d3125e9` Back up policy card build 048 snapshot

because that snapshot commit includes runtime-side off-grid and policy support.

Suggested exclusions from PR 1:

- `examples/`
- `frontend/`
- custom card files

### PR 2: Optional policy/reporting examples

Goal:

- add the optional dashboard assets only after the integration path is accepted

Primary areas:

- `examples/lovelace/`
- `examples/www/`

Commits most closely aligned with this:

- `a29bf17` feat: add bytewatt policy dashboard examples
- `a8ff4eb` fix: default policy card to battery variant
- `6d999c2` feat: wire bytewatt example cards to live entities
- `0f29119` docs: label unsupported policy fields as not enabled
- `5e95094` feat: add advanced battery policy controls
- `6fa3b75` feat: add runtime settings target selector
- `4a21827` fix: add in-card battery target selector
- `1dc3d73` feat: make policy card fields directly editable
- `a7aee88` feat: add save feedback to policy card
- `6f8915f` Update backup with v032 summary split
- `542cb7e` Update backup with v037 mobile summary fixes
- `f8f192b` Add ByteWatt reporting card and payload
- `dd7d06a` Refine ByteWatt reporting card layout
- `8c104f2` Add realtime flow section to report card
- `c4fa93e` Add CSV export to report card
- `ae720d0` Visualize statistical report metrics
- `780b329` Add report card summary banner
- `5e2c2fc` Add all-systems comparison section to report card

Suggested note to upstream:

- these cards are optional examples, not a required integration dependency

### PR 3: Frontend package split follow-up

Goal:

- move optional cards into a standalone HACS dashboard repo

Primary areas:

- `frontend/bytewatt-card/`
- `scripts/export_frontend_package.ps1`

Commits most closely aligned with this:

- `e720cc4` Add frontend package scaffold for optional cards
- `b5a6115` Add frontend export workflow and split checklist

This should probably stay out of the integration PR entirely unless the owner
explicitly wants it kept in-tree as scaffolding.

## Lowest-friction upstream path

If we want the best chance of an upstream merge:

1. send the owner the outreach note first
2. offer PR 1 by itself
3. only bring PR 2 forward if the owner is comfortable with optional examples
4. keep PR 3 separate unless asked

## Practical note

The current backup branch is intentionally broader than a clean upstream PR.
Before opening a real PR, create a fresh review branch and cherry-pick only the
commits intended for that PR.
