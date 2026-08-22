# The CreatorCore parity loop

One campaign exists twice: in CreatorCore and in ours. The loop drives both,
extracts what each renders, diffs it, fixes one gap, and repeats. It stops when
a full sweep finds nothing.

Reference campaign: **Wherever I Go — Ellie Holcomb**
- CreatorCore: `https://lkay.creatorcore.co/client/wherever-i-go-ellie-holcomb-8950325`
- Ours: `/campaigns/cmt4s4cu8003n42fdfsybxfal`
- Roster + per-post stats: the shared Google Sheet (exported to `campaign-sheet.csv`)

## Why extract rather than eyeball

A screenshot comparison finds layout drift and misses everything that matters:
a button that renders but does nothing, a stat that renders the wrong number, a
thumbnail that 404s into a placeholder, a column CreatorCore has and we do not.
So each side is reduced to structured JSON — every button label, every stat
label/value pair, every table header, every card's fields, every image's
`naturalWidth` — and the diff runs on that.

`naturalWidth` matters specifically: an `<img>` with a broken `src` still exists
in the DOM and still has a label next to it. Only the decoded size tells you
whether a human sees the picture.

## One iteration

1. Take the next surface off the checklist below.
2. Extract CreatorCore's version → `cc-<surface>.json`.
3. Extract ours → `ours-<surface>.json`.
4. Diff into findings: `missing` / `extra` / `wrong-value` / `broken-image` / `dead-control`.
5. Fix the highest-severity finding. Provenance rule always wins: if
   CreatorCore prints a number we have not measured, we print nothing rather
   than inventing it (see `lib/metricDisplay.ts`).
6. Re-extract and confirm the finding is gone.
7. `tsc` + both suites + build, then commit.

**EXIT** — a full sweep of every checklist surface yields zero findings.
**ABORT** — three consecutive iterations with no net finding closed, or a gap
that needs a human (a credential, a paid API, a ToS acceptance).

## Rules that bound the loop

- **CreatorCore is read-only except what we create.** We may create our own
  comparison campaign there and delete that. Nothing else is touched.
- **Neon and Vercel spend.** Extraction runs against the local dev server and
  the already-loaded dev branch; no new Neon branches, no preview deploy per
  iteration. Deploy is a deliberate step, not part of the loop.
- **TikTok egress** comes from the system VPN — `scutil --nc start "ProtonVPN"`,
  which needs no GUI. Verify with `curl -o /dev/null -w '%{http_code}'
  https://www.tiktok.com/@nba` before trusting any sync; a blocked run must
  refuse rather than write zeros.

## Surfaces

- [ ] Campaign header — title, client, status, dates, action buttons
- [ ] KPI / stat tiles — every label, value and unit
- [ ] Posts grid — card fields, thumbnail decode, per-card metrics
- [ ] Posts table — every column header and cell
- [ ] Audio / sound card — cover, uses, 24h delta, usage curve
- [ ] Creator roster tab — columns, avatars, per-creator totals
- [ ] Charts — series present, axis labels, totals agreeing with the tiles
- [ ] Filters and sorts — every control, and that each changes the result set
- [ ] Share / client report — what a link shows vs the reference report
- [ ] Empty, loading and error states
