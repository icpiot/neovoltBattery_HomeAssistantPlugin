# Byte-Watt Card Suite

This folder is a frontend-package scaffold for the optional Byte-Watt Lovelace cards.

It packages:

- `bytewatt-policy-card.js`
- `bytewatt-report-card.js`
- `bytewatt-card-suite.js`

The suite module imports both cards, so a future standalone HACS frontend repo
would only need a single Lovelace resource.

## Current builds

- Policy card: `048`
- Reporting card: `008`
- Suite loader: `001`

## If used manually today

Copy this folder into Home Assistant:

- `/config/www/community/bytewatt-card/`

Then add one resource:

```yaml
url: /local/community/bytewatt-card/bytewatt-card-suite.js?v=001
type: module
```

That resource will register both:

- `custom:bytewatt-policy-card`
- `custom:bytewatt-report-card`

## Important limitation

This repo is currently a HACS **integration** repo.

HACS can only install one repository category at a time, so these frontend
files are not auto-installed with the integration itself. This folder exists so
we can cleanly split the cards into their own HACS frontend repo later without
having to redesign the package structure again.
