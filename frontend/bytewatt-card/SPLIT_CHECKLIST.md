# Byte-Watt Frontend Split Checklist

Use this checklist when moving the optional cards into a standalone HACS
**frontend** repository.

## Goal

Create a second repository that installs the optional Lovelace cards without
bundling them into the integration repository.

Recommended repo name:

- `icpiot/bytewatt-card`

## Files to keep in the frontend repo root

- `bytewatt-card-suite.js`
- `bytewatt-policy-card.js`
- `bytewatt-report-card.js`
- `README.md`
- `hacs.json`
- `VERSION.txt`

## HACS target state

The standalone frontend repo should have:

- `hacs.json` with `content_in_root: true`
- `filename: "bytewatt-card-suite.js"`
- repository category set to **Dashboard**

The Lovelace resource should be:

```yaml
url: /local/community/bytewatt-card/bytewatt-card-suite.js?v=001
type: module
```

## Split steps

1. Create the new GitHub repository.
2. Copy the contents of `frontend/bytewatt-card/` into the new repo root.
3. Update `README.md` in the new repo so it no longer describes itself as a scaffold.
4. Verify `hacs.json` still points at `bytewatt-card-suite.js`.
5. Add screenshots and card examples for:
   - `custom:bytewatt-policy-card`
   - `custom:bytewatt-report-card`
6. Tag an initial release after testing.
7. Add the new repo as a HACS custom repository with category **Dashboard**.
8. Keep this integration repo focused on `custom_components/bytewatt`.

## Versioning rules

- Bump the internal policy card build whenever `bytewatt-policy-card.js` changes.
- Bump the internal reporting card build whenever `bytewatt-report-card.js` changes.
- Bump the suite loader version whenever the packaged resource changes.
- Update `VERSION.txt` every time one of those versions changes.
- Update the Lovelace resource cache-buster to match the suite loader version.

## Recommended release flow

1. Make card changes in the main working repo first.
2. Copy the refreshed card files into `frontend/bytewatt-card/`.
3. Update `VERSION.txt`.
4. Run the export script from this repo.
5. Commit the exported files into the standalone frontend repo.
6. Tag and release from the frontend repo.

## Important note

This repo can continue to keep `examples/` copies for development and archive
history, but the installable frontend package should eventually come only from
the standalone dashboard repo.
