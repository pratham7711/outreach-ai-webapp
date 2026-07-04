# Metrics Formulas

Reference for `lib/metrics/` (`emv.ts`, `costs.ts`, `benchmarks.ts`, `numbers.ts`). All functions are pure and deterministic: no I/O, no database access, no clock reads. This document is the single home for formula rationale — the code itself is comment-free by project policy.

## Number handling (applies everywhere)

- Counts (`views`, `likes`, `comments`, `shares`, `saves`, `spend`, `engagements`): missing, `null`, `undefined`, `NaN`, or `±Infinity` are treated as `0` (`toCount`).
- Ratio inputs (`value`, `baseline`, `campaignValue`, `orgValues` entries): non-finite values are treated as absent and produce `null` outputs rather than garbage numbers (`toFiniteOrNull`).
- Money outputs (EMV, CPM, CPE) are rounded to 2 decimal places by the shared `roundMoney` helper (half-away-from-zero, epsilon-corrected). Ratio outputs (engagement rate, `delta`, `pct`, `orgAvg`) are returned unrounded; callers format for display.
- No function ever returns `NaN` or `Infinity`. Division guards return `null` instead.

## Earned Media Value (EMV)

### Formula

```
postEMV = views    x rate.view
        + likes    x rate.like
        + comments x rate.comment
        + shares   x rate.share
        + saves    x rate.save

campaignEMV = roundMoney( sum(postEMV_unrounded for each post) )
```

`computePostEmv(input)` returns the post EMV rounded to 2 dp. `computeCampaignEmv(posts)` sums the unrounded per-post values and rounds once, so the campaign total does not accumulate per-post rounding drift.

A platform string outside the rate table (e.g. `TWITTER`, which exists in the Prisma `Platform` enum but is not an EMV surface for this product) resolves to a zero rate card and contributes $0. Rates can be inspected via the exported `EMV_RATES` constant or `getEmvRates(platform)`.

### Rate table (USD per interaction)

| Platform  | View  | Like  | Comment | Share | Save  |
|-----------|-------|-------|---------|-------|-------|
| TIKTOK    | $0.04 | $0.50 | $1.50   | $1.25 | $1.25 |
| INSTAGRAM | $0.12 | $0.32 | $3.82   | $2.83 | $1.25 |
| YOUTUBE   | $0.12 | $0.56 | $3.34   | $2.69 | $1.25 |

### Source attribution

Primary source: **Ayzenberg Group Earned Media Value Index (AEMVI), October 2016 report** — the published baseline "Value Per" tables (PDF hosted by a.list: https://www.alistdaily.com/wp-content/uploads/2016/02/Ayzenberg-EMV-Index_OCT2016.pdf). Ayzenberg's current Social Index (https://earnedmediavalues.com/) publishes daily-fluctuating values behind a login; the October 2016 report is the last fully public static table, so it is used as the default baseline here. Per-cell provenance:

| Cell | Value | Provenance |
|---|---|---|
| INSTAGRAM view | $0.12 | AEMVI Oct 2016, Instagram Value Per View |
| INSTAGRAM like | $0.32 | AEMVI Oct 2016, Instagram Value Per Like |
| INSTAGRAM comment | $3.82 | AEMVI Oct 2016, Instagram Value Per Comment |
| INSTAGRAM share | $2.83 | AEMVI Oct 2016 lists Instagram Value Per Share as N/A; Facebook Value Per Share ($2.83) used as the nearest feed-share analog on a Meta platform |
| INSTAGRAM save | $1.25 | Not tracked by AEMVI; Pinterest Value Per Pin/Share ($1.25) used as the save-to-collection analog |
| YOUTUBE view | $0.12 | AEMVI Oct 2016, YouTube Value Per View |
| YOUTUBE like | $0.56 | AEMVI Oct 2016, YouTube Value Per Like |
| YOUTUBE comment | $3.34 | AEMVI Oct 2016, YouTube Value Per Comment |
| YOUTUBE share | $2.69 | AEMVI Oct 2016, YouTube Value Per Share |
| YOUTUBE save | $1.25 | Not tracked by AEMVI; Pinterest Value Per Pin/Share analog (save-to-playlist) |
| TIKTOK view | $0.04 | Ayzenberg Social Index TikTok guidance: value per view "in the sub $.05 range" (a.list, "Ayzenberg Social Index Adds Earned Media Values For TikTok", https://www.alistdaily.com/technology/ayzenberg-social-index-adds-earned-media-values-for-tiktok/); $0.04 also matches AEMVI Oct 2016 Snapchat Value Per View, the report's short-video comparable |
| TIKTOK like | $0.50 | AEMVI Oct 2016 Vine Value Per Like — Vine is the index's short-form looping-video platform, the closest structural analog to TikTok |
| TIKTOK comment | $1.50 | AEMVI Oct 2016 Vine Value Per Comment (same analog) |
| TIKTOK share | $1.25 | AEMVI Oct 2016 Vine Value Per Share (same analog) |
| TIKTOK save | $1.25 | Not tracked by AEMVI; Pinterest Value Per Pin/Share analog (favorites/bookmarks) |

These are static product defaults in the Ayzenberg style, not live Ayzenberg index values. If EMV rates ever become org-configurable, this table is the fallback.

## Cost metrics (`costs.ts`)

| Function | Formula | Null when |
|---|---|---|
| `computeCpm({ spend, views })` | `roundMoney(spend / views * 1000)` | `views <= 0` |
| `computeCpe({ spend, engagements })` | `roundMoney(spend / engagements)` | `engagements <= 0` |
| `computeEngagementRate({ views, likes, comments, shares, saves })` | `sumEngagements / views` (unrounded ratio, e.g. `0.1295` = 12.95%) | `views <= 0` |
| `sumEngagements({ likes, comments, shares, saves })` | `likes + comments + shares + saves` | never (missing counts are 0) |

Views are reach; engagements are the four active interactions. Views are never counted as engagements.

## Benchmarks (`benchmarks.ts`)

`compareToBaseline({ value, baseline })` returns:

```
delta = value - baseline
pct   = (delta / baseline) * 100
```

Both are `null` if either input is missing/non-finite; `pct` alone is `null` when `baseline` is `0`.

`campaignVsOrgAverage({ campaignValue, orgValues })` returns:

```
orgAvg = mean(finite entries of orgValues)
delta  = campaignValue - orgAvg
pct    = (delta / orgAvg) * 100
```

If `orgValues` has no finite entries, all three fields are `null`. If only `campaignValue` is missing/non-finite, `orgAvg` is still returned and `delta`/`pct` are `null`. `pct` is `null` when `orgAvg` is `0`. Outputs are unrounded.

## Worked examples (hand-computed)

### TikTok post

Input: 100,000 views, 12,000 likes, 300 comments, 450 shares, 200 saves, $1,500 spend.

```
EMV  = 100,000 x 0.04 = 4,000.00
     +  12,000 x 0.50 = 6,000.00
     +     300 x 1.50 =   450.00
     +     450 x 1.25 =   562.50
     +     200 x 1.25 =   250.00
     = $11,262.50

engagements = 12,000 + 300 + 450 + 200 = 12,950
CPM  = 1,500 / 100,000 x 1,000 = $15.00
CPE  = 1,500 / 12,950 = 0.11583... -> $0.12
ER   = 12,950 / 100,000 = 0.1295 (12.95%)
```

### Instagram post

Input: 50,000 views, 4,000 likes, 150 comments, 90 shares, 260 saves, $2,000 spend.

```
EMV  = 50,000 x 0.12 = 6,000.00
     +  4,000 x 0.32 = 1,280.00
     +    150 x 3.82 =   573.00
     +     90 x 2.83 =   254.70
     +    260 x 1.25 =   325.00
     = $8,432.70

engagements = 4,000 + 150 + 90 + 260 = 4,500
CPM  = 2,000 / 50,000 x 1,000 = $40.00
CPE  = 2,000 / 4,500 = 0.4444... -> $0.44
ER   = 4,500 / 50,000 = 0.09 (9.00%)
```

### YouTube post

Input: 20,000 views, 900 likes, 120 comments, 60 shares, 40 saves, $800 spend.

```
EMV  = 20,000 x 0.12 = 2,400.00
     +    900 x 0.56 =   504.00
     +    120 x 3.34 =   400.80
     +     60 x 2.69 =   161.40
     +     40 x 1.25 =    50.00
     = $3,516.20

engagements = 900 + 120 + 60 + 40 = 1,120
CPM  = 800 / 20,000 x 1,000 = $40.00
CPE  = 800 / 1,120 = 0.71428... -> $0.71
ER   = 1,120 / 20,000 = 0.056 (5.60%)
```

### Campaign roll-up and benchmarks

```
campaignEMV = 11,262.50 + 8,432.70 + 3,516.20 = $23,211.40

compareToBaseline({ value: 3516.20, baseline: 3000 })
  delta = 516.20
  pct   = 516.20 / 3,000 x 100 = 17.2066...%

campaignVsOrgAverage({ campaignValue: 8432.70, orgValues: [6000, 9000, 7500] })
  orgAvg = (6,000 + 9,000 + 7,500) / 3 = 7,500
  delta  = 8,432.70 - 7,500 = 932.70
  pct    = 932.70 / 7,500 x 100 = 12.436%
```

## Bot / Botted-view signals

Reference for `lib/fraud/botSignals.ts`. Meta and Instagram give only lifetime (cumulative) counts, never a per-post time series, so this product builds its own history from `PostMetricSnapshot` polling (hourly for the first 72h a post is tracked). `detectBotSignals` reads that ordered snapshot series and surfaces suspicious growth patterns; every function is pure and deterministic (no I/O, no clock reads). These signals are advisory — they feed the human fraud review and can be promoted to a `ViewFraudFlag` via the manual flag endpoint.

### Velocities

`computeVelocities(series)` derives per-interval rates between consecutive snapshots:

```
hours          = (to.recordedAt - from.recordedAt) / 3,600,000
viewsPerHour       = max(0, to.views  - from.views)                       / hours
engagementPerHour  = max(0, (to.likes + to.comments) - (from.likes + from.comments)) / hours
```

Deltas are floored at 0 so a corrected/decremented count never produces a negative rate. Intervals with a non-finite timestamp or `hours <= 0` are dropped. A series of N snapshots yields at most N-1 velocity rows.

### Signal detection

`detectBotSignals(series)` returns `[]` unless there are at least **3 snapshots** and at least one valid velocity interval. All arithmetic guards against non-finite inputs (missing counts are treated as 0; a 0 median/mean disables the ratio checks rather than dividing by zero). Three heuristics run:

| Signal | Condition | Rationale |
|---|---|---|
| `VIEW_SPIKE` | On any interval, `viewsPerHour > 5 x median(viewsPerHour)` **and** `engagementPerHour < 1.5 x median(engagementPerHour)` | Real virality drags likes/comments up with views. Views surging while engagement stays flat is the fingerprint of purchased/botted impressions. |
| `LOW_ENGAGEMENT` | Latest cumulative engagement rate `(likes + comments) / views < 0.5%` **and** `views > 10,000` | Above ~10k views a genuinely-seen post accrues engagement; a sub-0.5% rate at that scale indicates views without humans behind them. The view floor avoids flagging tiny early samples. |
| `BOT_PATTERN` | `stddev(viewsPerHour) / mean(viewsPerHour) < 0.1` across `>= 6` intervals with `views > 5,000` | Organic reach decays — velocity falls over time. A near-constant drip (coefficient of variation under 0.1) over 6+ intervals is mechanical, the signature of a steady bot feed rather than a decay curve. |

### Threshold choices

- **5x median / 1.5x median** (VIEW_SPIKE): median (not mean) as the baseline so a single spike does not inflate its own reference. 5x is well outside normal interval-to-interval variance; the 1.5x engagement gate ensures we only fire when engagement fails to keep pace.
- **0.5% rate, 10k views** (LOW_ENGAGEMENT): 0.5% sits below the low end of healthy short-form engagement (typically 1-6%); 10k views is the sample size where the rate is statistically meaningful.
- **CV < 0.1, >= 6 intervals, > 5k views** (BOT_PATTERN): 6 intervals is the minimum for a stddev/mean judgement to be stable; a coefficient of variation under 0.1 (velocity within +/-10% of its mean) is far tighter than any organic decay.

### Severity

Each signal is graded `LOW | MEDIUM | HIGH` by how far past its threshold it sits: VIEW_SPIKE by the view/median ratio (>=10x HIGH, >=7x MEDIUM, else LOW), LOW_ENGAGEMENT by the rate (<0.1% HIGH, <0.25% MEDIUM, else LOW), BOT_PATTERN by the coefficient of variation (<0.03 HIGH, <0.06 MEDIUM, else LOW).
