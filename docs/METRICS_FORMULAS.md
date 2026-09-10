# Metrics Formulas

Reference for `lib/metrics/` (`costs.ts`, `benchmarks.ts`, `numbers.ts`). All functions are pure and deterministic: no I/O, no database access, no clock reads. This document is the single home for formula rationale — the code itself is comment-free by project policy.

## Number handling (applies everywhere)

- Counts (`views`, `likes`, `comments`, `shares`, `saves`, `spend`, `engagements`): missing, `null`, `undefined`, `NaN`, or `±Infinity` are treated as `0` (`toCount`).
- Ratio inputs (`value`, `baseline`, `campaignValue`, `orgValues` entries): non-finite values are treated as absent and produce `null` outputs rather than garbage numbers (`toFiniteOrNull`).
- Money outputs (CPM, CPE) are rounded to 2 decimal places by the shared `roundMoney` helper (half-away-from-zero, epsilon-corrected). Ratio outputs (engagement rate, `delta`, `pct`, `orgAvg`) are returned unrounded; callers format for display.
- No function ever returns `NaN` or `Infinity`. Division guards return `null` instead.

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
engagements = 12,000 + 300 + 450 + 200 = 12,950
CPM  = 1,500 / 100,000 x 1,000 = $15.00
CPE  = 1,500 / 12,950 = 0.11583... -> $0.12
ER   = 12,950 / 100,000 = 0.1295 (12.95%)
```

### Instagram post

Input: 50,000 views, 4,000 likes, 150 comments, 90 shares, 260 saves, $2,000 spend.

```
engagements = 4,000 + 150 + 90 + 260 = 4,500
CPM  = 2,000 / 50,000 x 1,000 = $40.00
CPE  = 2,000 / 4,500 = 0.4444... -> $0.44
ER   = 4,500 / 50,000 = 0.09 (9.00%)
```

### YouTube post

Input: 20,000 views, 900 likes, 120 comments, 60 shares, 40 saves, $800 spend.

```
engagements = 900 + 120 + 60 + 40 = 1,120
CPM  = 800 / 20,000 x 1,000 = $40.00
CPE  = 800 / 1,120 = 0.71428... -> $0.71
ER   = 1,120 / 20,000 = 0.056 (5.60%)
```

### Campaign roll-up and benchmarks

```
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
