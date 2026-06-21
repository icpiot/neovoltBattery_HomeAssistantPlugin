# Owner Outreach Draft

Hi,

I've been doing a substantial hardening pass on my fork of the Byte-Watt /
Neovolt Home Assistant integration and wanted to check whether you'd be open to
reviewing it for upstreaming.

The work focuses on:

- Home Assistant compatibility and cleanup
- staged settings behavior for charge / discharge / feed-in flows
- multi-battery policy handling
- off-grid SOC support
- improved optional example dashboards/cards
- HACS/install documentation cleanup

I kept the core runtime work in `custom_components/bytewatt` and treated the
custom cards as optional examples rather than making them required for the
integration.

To make review easier, I also prepared a frontend-package scaffold so the
optional cards can eventually live in a separate dashboard repo if that is the
cleaner path.

If you're open to it, I can send:

- a PR against the integration changes first
- the optional card/example work as a separate review discussion
- a concise install/test checklist

I've documented the current handoff summary here:

- `docs/UPSTREAM_PR_DRAFT.md`

Happy to trim or split the changes however you'd prefer so review stays
manageable.
