# Design critique — desktop-1600

`scripts/creatorcore/out/parity-ours/2026-09-13T20-36-12` vs `scripts/creatorcore/out/parity/2026-09-13T19-01-43`

Findings come from named design laws, not from taste. Each one cites the law
it fails and the token or class that would move it. Grouped by rule because
one broken recipe repeated across 25 screens is **one** fix.

**82 findings** over 39 surfaces — high 6, med 75, low 1.

| rule | law | severity | n | surfaces |
|---|---|---|---|---|
| `wcag/contrast-below-aa` | WCAG 1.4.3 | high | 76 | 39 |
| `fitts/target-below-wcag-minimum` | Fitts / WCAG 2.5.8 | high | 1 | 1 |
| `fitts/adjacent-targets-no-gap` | Fitts | med | 4 | 1 |
| `harness/ground-unresolved` | harness health | low | 1 | 1 |

## `wcag/contrast-below-aa` — WCAG 1.4.3

**Fix:** Re-point the ink token, not the literal -- --cc-text-muted / --cc-text-subtle.

- **nav-dashboard** · page.header-strip › "7D" — Contrast 3.24:1 against its ground; AA needs 4.5:1 at 12px/600.
- **nav-dashboard** · page.header-strip › "30D" — Contrast 3.24:1 against its ground; AA needs 4.5:1 at 12px/600.
- **nav-dashboard** · page.header-strip › "90D" — Contrast 3.24:1 against its ground; AA needs 4.5:1 at 12px/600.
- **nav-dashboard** · page.header-strip › "1Y" — Contrast 3.24:1 against its ground; AA needs 4.5:1 at 12px/600.
- **settings-team** · list.rows › "OWNER" — Contrast 2.86:1 against its ground; AA needs 4.5:1 at 11px/600.
- **campaign-analytics** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-creators** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-documents** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-drafts** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-edit** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-financials** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-overview** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-performance** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-posts** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- **campaign-reviews** · campaign.rail › "9+" — Contrast 3.55:1 against its ground; AA needs 4.5:1 at 9px/700.
- _…and 61 more_

## `fitts/target-below-wcag-minimum` — Fitts / WCAG 2.5.8

**Fix:** Give the control a padded box -- `.cc-icon-btn` sizes from --cc-icon-btn-size.

- **nav-payouts** · list.rows › toggle "Select payout for billboard" — Hit target is 16×16px; WCAG 2.2 AA requires 24×24 and a comfortable pointer target is 40×40.

## `fitts/adjacent-targets-no-gap` — Fitts

**Fix:** Raise the cluster gap token (--cc-*-gap) to at least 8px.

- **nav-dashboard** · page.header-strip › "7D" ↔ "30D" — 4.0px of clear space between two adjacent targets; a near-miss activates the wrong one.
- **nav-dashboard** · page.header-strip › "30D" ↔ "90D" — 3.9px of clear space between two adjacent targets; a near-miss activates the wrong one.
- **nav-dashboard** · page.header-strip › "90D" ↔ "6M" — 4.1px of clear space between two adjacent targets; a near-miss activates the wrong one.
- **nav-dashboard** · page.header-strip › "6M" ↔ "1Y" — 3.9px of clear space between two adjacent targets; a near-miss activates the wrong one.

## `harness/ground-unresolved` — harness health

**Fix:** Raise the tree cap, or treat this node as unmeasured.

- **nav-dashboard** · shell.rail.items › "Dashboard" — Ink and ground resolved to the same colour (rgb(255, 255, 255)); this node's painted ancestor is not in the tree, so its contrast was not measured.
