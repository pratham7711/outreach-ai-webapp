# Design critique — desktop-1600

`scripts/creatorcore/out/parity-ours/2026-09-14T02-22-05` vs `scripts/creatorcore/out/parity/2026-09-14T02-14-34`

Findings come from named design laws, not from taste. Each one cites the law
it fails and the token or class that would move it. Grouped by rule because
one broken recipe repeated across 25 screens is **one** fix.

**1 findings** over 39 surfaces — high 0, med 0, low 1.

| rule | law | severity | n | surfaces |
|---|---|---|---|---|
| `jakob/controls-absent-from-reference` | Jakob | low | 1 | 1 |

## `jakob/controls-absent-from-reference` — Jakob

**Fix:** Either hide it in this theme ([data-action] + display token) or accept it and record why.

- **settings-team** · page.header-strip › 1 extra control — We render "Invite Member"; the reference cluster has no counterpart.
