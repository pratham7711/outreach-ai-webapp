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

- [x] Campaign header — title, client, status, dates, action buttons
- [x] KPI / stat tiles — every label, value and unit
- [x] Posts grid — card fields, thumbnail decode, per-card metrics
- [ ] Posts table — every column header and cell
- [x] Audio / sound card — cover, uses, 24h delta, usage curve
- [ ] Creator roster tab — columns, avatars, per-creator totals
- [ ] Charts — series present, axis labels, totals agreeing with the tiles
- [ ] Filters and sorts — every control, and that each changes the result set
- [x] Share / client report — what a link shows vs the reference report
- [ ] Empty, loading and error states

## Closed findings

Each was found by the extract-and-diff above, fixed at its root, and confirmed
gone by re-extracting. The measurement quoted is the one taken after the fix.

| Finding | Root cause | Confirmed by |
|---|---|---|
| Post thumbnails rendered as empty boxes on any Indian ISP | the proxy host allowlist named `tiktokcdn-us` but not the `-sg`/plain `tiktokcdn.com` families, so those URLs skipped the proxy | 25/25 images decode |
| Every counter we had not read showed as `0` | fabricated zeros at four levels, ending at `typeof x === "number" ? x : 0` in the Instagram fetchers | `measured: ["views","comments"]` recorded from a live sync |
| The client report listed no posts at all | `campaignPerformance` never selected them | 17 post cards, matching CC's 17 |
| Every post claimed it was published the day we added it | `applyPostMetrics` never wrote `postedAt`, so the create-time stamp stood | 15/17 dates match CC |
| Live Posts and Status tiles missing | not computed | 17 live of 17, In-Progress |
| Total Saves blank | `collectCount` was in every payload and unparsed; then `assemblePostMetrics` (a whitelist) dropped it | 1,785 vs CC's 1,762; `@awxyken` 134 vs 134 |
| Audio card had no velocity view | only the usage series was plotted | pill toggle switches series |
| First sound snapshot invented a 24h delta equal to its lifetime total | no baseline to subtract | writes 0 with no baseline |
| YouTube reported `sharesCount: 0` and stamped today as the publish date | `Number(x) \|\| 0` and a `new Date()` fallback in `mapYouTubeItem`; same in the SocialKit branch | shares stay undefined on a full payload |

## Known ceilings

Not defects, and not worth re-litigating each sweep:

- **Total Downloads.** CreatorCore prints it, per post and in total, so it is
  real platform data. TikTok publishes `download_count` only in its app API's
  `statistics` object, which answers an unsigned request with an empty 200 — it
  wants `X-Gorgon`/`X-Argus`. The web payload we read has `playCount`,
  `diggCount`, `commentCount`, `shareCount`, `collectCount` and
  `statsV2.repostCount`, plus `author.downloadSetting` (a permission flag) and
  `video.downloadAddr` (the file URL). No count. So the tile stays absent.
- **`Post.postedAt` is `NOT NULL`,** so the create path stamps `new Date()` when
  the platform did not say. The first successful sync corrects it; a post that
  has never synced shows the day it was added. Fixing it properly needs a
  nullable column, and prod has no migration history.
- **The sound cover 502s from this ISP** and returns 200 through the tunnel, so
  it resolves from Vercel and falls back to its placeholder icon locally. The
  comparison cuts both ways: on this network CreatorCore's own report decodes
  none of its background images, because it hotlinks the CDN where we proxy.
- **Structural, not informational:** CreatorCore groups Total Views / Eng. Rate
  / Total Eng. under a "Post Performance" heading; ours is one flat tile grid
  carrying the same numbers.
