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
- [x] Posts table — every column header and cell
- [x] Audio / sound card — cover, uses, 24h delta, usage curve
- [x] Creator roster tab — columns, avatars, per-creator totals
- [x] Charts — series present, axis labels, totals agreeing with the tiles
- [x] Filters and sorts — every control, and that each changes the result set
- [x] Share / client report — what a link shows vs the reference report
- [x] Empty, loading and error states

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
| Post cards showed no shares, no saves and no posted date | shares and saves were held back while an unfetched counter still read as `0`; the date was never rendered | card reads `37 shares 134 saves … Posted 21 Aug 2026`, saves matching CC exactly |
| A link could not point at a campaign tab | the tab lived in `useState`, so the URL never named it | 7 cases: three deep links, default, two clicks, one bogus value |
| The roster showed `0 followers` for all 25 creators | nothing had ever written `Creator.followersCount`, and the roster printed the `Float @default(0)` as a measurement | 14/14 TikTok creators filled from a payload we already fetch — `@awxyken` 1.3M |
| The roster had no Rate column | the number was in the row data and never rendered | column renders, `—` where no rate was agreed |
| The Views-by-Platform pie drew a frame around no data | unguarded call site, unlike the bar chart three lines below it | every chart call site now guarded; sweep reports zero |
| A share report that threw showed the client Next's own error screen | the `(public)` group had no `error.tsx`, and neither did `(portal)`, `(auth)` or the root — every boundary in the app lived under `(dashboard)` | `?boom=1` on a live share link renders the card, an error ID and a retry, and leaks neither the message nor a stack |
| A client following a share link watched a blank tab for up to 1.9s | the route had no `loading.tsx`, so nothing streamed until every query had returned | 65 skeleton elements laid out at ~700ms, replaced by the report and its 4 charts |
| `/connections` answered a failed request with "0 connected, 0 available" | `if (res.ok)` with no else, so a 500 left the fixed platform catalogue empty and the page reported that as a fact | with the API forced to 500 the page says so and offers Retry, which recovers in place |
| A link to a creator watchlist opened the Audios tab | `sub` lived in `useState("sound")` while the comment above it documented `?sub=sound\|creator`, so the URL never named the half of the page being shown | `?sub=creator` opens Creators, `?sub=sound` opens Audios, a bogus value falls back, and a reload stays put |

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
- **Wording, deliberately:** their card says "Last Updated", ours "Updated" —
  the long form plus a "3 months ago" overflows a 240px card. Their KPI row
  mixes "Average Post Eng Rate" with "Avg. Campaign Eng Rate"; ours abbreviates
  both. A label diff reports these every sweep; they are not findings.
- **Instagram follower counts** need `INSTAGRAM_BUSINESS_TOKEN`, which is not
  configured, so the three Instagram creators on the reference campaign read
  `—`. The plumbing is in place and unit-tested but has never run against the
  live API.
- **Two creator columns carry no sort control, deliberately.** `followersCount`
  is `Float @default(0)`, so the 1,823 creators whose count never came across
  the import hold 0 rather than NULL, and the list already renders those blank
  because an unfetched 0 is unknown and not a measurement. Ascending order would
  rank every one of them as the least-followed creator in the roster. Avg. Views
  is worse: it is derived after pagination, so ordering by it would sort only the
  rows already on screen. `lib/listFilters` states both reasons at the sort-key
  list. A column that cannot be ordered truthfully gets no control rather than a
  misleading one.
- **Filters live in the URL on two pages and in component state on five.**
  `/campaigns` and `/creators` put every filter in the query string, so a
  filtered view survives a refresh and can be pasted to a colleague; `/clients`,
  `/payouts`, `/discovery`, `/songs` and `/recipients` keep their search in
  `useState`. Both behave correctly, and moving the other five is a change to how
  those pages are shared rather than a defect in them.
- **The image proxy has no retry.** A cold Posts tab fires ~16 concurrent TikTok
  CDN fetches and, from an ISP that filters TikTok, some come back 502; the
  route's year-long immutable cache means the warm load has one failure. Left
  alone: a retry would multiply requests against a CDN that is rate-limiting us.

## Reading a filter sweep

A sweep that drives every control and diffs the row count sounds decisive and
is easy to get wrong in four ways, all four hit here:

- **Click what the page actually renders.** The status filter on the campaigns
  and posts lists is `StatusTabs`, which renders `role="tab"` — a sweep looking
  for buttons reported nothing at all about the single most-used control on
  either page.
- **Sort headers only exist in list view,** and the default is grid. The first
  run found no sort controls anywhere and was measuring a view that has none.
- **A filter that excludes nothing proves nothing.** `createdFrom=2026-01-01`
  left all 519 campaigns in place, so "NO CHANGE" was the honest answer and said
  nothing about the filter. Re-driven with a date inside the data.
- **Seeded data can agree by accident.** Both tracker sorts — uses, added-24h,
  delta, velocity — return the identical order, which looks like three dead
  controls. The seed is perfectly monotonic across all four measures, so the
  orderings genuinely coincide; confirmed by computing each expected ordering
  from the database rather than by trusting the page.

Every remaining "NO CHANGE" on this surface has an explanation of that kind:
All and Grid are the defaults, and all 17 posts on the reference campaign are
already `PENDING REVIEW`, so filtering to Pending is a no-op on this data.

## Reading an empty-state sweep

Emptying a list from outside is harder than it looks, and the first two attempts
here measured nothing:

- **These lists are not `<table>`s.** Counting `tbody tr` reported zero rows on
  every page, including the one showing 521 campaigns. Read `<main>`'s text and
  diff it instead; the sidebar is most of `document.body` and never changes.
- **Only `/campaigns` and `/creators` take search from the URL.** The other
  eighteen ignore `?q=`, so a sweep that only edits the query string concludes
  nothing about them. Five of them have a search box that never reaches the URL
  and has to be typed into; eleven have no search control at all.
- **Regexes miss their own subject.** "No audit events" matched neither `no
  (events)` nor `no \w+ (yet|found|match)`, and the page was reported as failing
  when it was doing exactly the right thing. Two of the three findings in the
  first pass were bugs in the sweep.
- **An already-empty list is the same code path.** `/lists` has no lists for this
  org, so its search box changing nothing is not a dead control — the empty state
  was on screen before the sweep typed anything.

Where a list could not be emptied from outside, the check moves to the mount
site: an `<EmptyState>` actually rendered in a no-data branch, not merely
imported. Ten of the eleven had one. The eleventh was `/connections`, which is
a fixed catalogue rather than user data — for it, empty can only mean the
request failed, which is why it got an error state instead.

## Reading a chart sweep

Two traps, both hit once:

- **Count the right elements.** A Recharts pie draws `.recharts-sector`, not
  `path.recharts-curve` — a detector that looks only for curves, bars and dots
  reports a perfectly good pie as an empty chart. The two 240px charts on the
  Analytics tab read "0 series" until the selector included sectors.
- **Guard at the call site, not in the component.** The chart components take
  data as a prop and correctly render whatever they are given, so grepping them
  for a guard flags all of them. What matters is the mount site: `{rows.length >
  0 ? <Chart/> : <EmptyState/>}`. Checking the wrong layer produced eleven
  findings, none of them real.

## Still open on swept surfaces

Found by a sweep, deliberately not built — each is a feature, not a defect:

- CreatorCore's roster also carries **Payouts, Deliverables, Notes and
  Activity** columns. We have the payout and activation models; notes and a
  per-creator activity trail have no source yet.
- Their Posts tab has a **Manual** filter separating hand-added posts from
  auto-discovered ones, a **Views/Engagement** sort control, and a
  **New View / Filtering / Sorting / Grouping / Add Columns** table builder with
  saved views. Ours sorts by column header in list view and filters by status,
  platform, type, minimum views and post date.
