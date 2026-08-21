# CreatorCore — data-model evidence from the extract

**Source:** `scripts/creatorcore/out/*.jsonl`, pulled 2026-08-20 from the LKM reference org via the Bubble Data API. Regenerate this document with `node scripts/creatorcore/cc-field-inventory.mjs`.
**Method:** every record of every readable type, inventoried field by field — presence, populated count, observed types, and distinct-value count. Field names and shapes only; no record values, because these are real campaigns and creators.
**Scope:** this is the *storage* half of the picture. It says what CreatorCore keeps, not how its UI is arranged. Interaction-level detail belongs in `CREATORCORE_FULL_PRD_2026-08-12.md`, which was driven live.

Extract coverage: `campaign` 506 · `post` 18,680 · `campaign-postrefreshqueue` 14,264 · `statistic-post` **0** (the heaviest type; the backend timed out on every page, as its README warns). Four types are readable on the Data API; the other ten are refused.

---

## 1. The finding that changes our schema

CreatorCore records, **per post, per metric, whether that metric can be retrieved at all**:

| Field | Populated | Distinct |
|---|---|---|
| `viewsPullable` | 17,666 / 18,680 (95%) | false · true |
| `likesPullable` | 17,664 / 18,680 (95%) | false · true |
| `sharesPullable` | 10,853 / 18,680 (58%) | false · true |
| `savesPullable` | 9,834 / 18,680 (53%) | false · true |
| `downloadsPullable` | 9,834 / 18,680 (53%) | false · true |
| `repostsPullable` | 9,834 / 18,680 (53%) | true only |

This is the same problem we hit from the other end. Our `Post` counters are `Float @default(0)`, so a metric that was never fetched is indistinguishable from a genuine zero, and we reconstruct the difference by inference — `lib/metricDisplay.ts` uses `lastSyncedAt` as a tiebreak. It works (of 18,708 posts, all 96 with a sync stamp have real engagement and only 10 of 18,612 without one do) but it is a proxy for a fact CreatorCore stores outright, and it is coarse: one stamp for the whole row, where CreatorCore knows views are pullable and saves are not.

**Requirement.** Carry availability per metric rather than deriving it. A nullable `metricsAvailable Json` on `Post` (or six nullable booleans) lets a surface ask "is this knowable?" instead of "was this row ever touched?" — and distinguishes *not yet fetched* from *this platform will never give us this number*, which is a different sentence to show a user. Until then `lastSyncedAt` stays the tiebreak and every caller drops the cell rather than printing a placeholder.

**Corollary already shipped.** Hiding unmeasured figures is not our invention; it is forced by CreatorCore's own data. A platform that tracks pullability per metric cannot be rendering zeros for the unpullable ones.

---

## 2. What the reference org actually fills in

Coverage is the most useful column in the inventory, because it separates the product's spine from its long tail. Across 506 campaigns:

| Field | Populated | Reading |
|---|---|---|
| `title`, `status`, `thumbnail`, `currency`, `refreshInterval` | 506 (100%) | the spine — always present |
| `posts`, `snapshots`, `lastRefresh`, `recentSnapshot` | 504 (100%) | post tracking is the product |
| `modules` | 469 (93%) | per-campaign Analytics module layout |
| `publicTitle`, `linkPreview` | 485 (96%) | the share/portal surface is standard, not optional |
| `folders` | 145 (29%) | grouping is used but not universal |
| `activations` | 13 (3%) | the draft/approval pipeline is barely used in this org |
| `creatorProfiles` | 13 (3%) | same |
| `metatags` | 12 (2%) | |
| `creatorRateTotals`, `commissionTotal`, `profitTotal` | 9 (2%) | per-campaign P&L, rarely filled |
| `creativeBrief` | 3 (1%) | |
| `client` | 2 (0.4%) | |
| **`budget`** | **1 (0.2%)** | |

Two conclusions worth acting on:

**Budget is optional in the reference too.** One campaign in 506 carries a budget. Making it an optional input and rendering nothing when absent matches CreatorCore's own data, not just our instruction. Same for `client` (2) and `creativeBrief` (3) — surfaces that assume these exist will be empty for essentially every campaign.

**The activation/drafts pipeline is aspirational here.** 13 campaigns of 506 have activations. The PRD calls Drafts "the pitch→paid loop the product sells; our clone's biggest gap" — true of the product, but this org does not run it. Worth confirming against the live UI before we build to it, since the extract cannot distinguish "feature nobody uses" from "feature stored elsewhere".

---

## 3. Vocabularies the extract pins down

Values small enough to enumerate are the product's own taxonomy:

- **`post.platform`**: `Instagram` · `TikTok` · `YouTube`. Three, not more. Our `Platform` enum should not grow past what the reference tracks without a reason.
- **`post.status`**: `Error` · `Success` · `Unavailable`. This is fetch state, distinct from approval state — our `PostFetchState` already mirrors it. Dead-link detection in the UI is this field.
- **`campaign.status`**: four values, and they are **Bubble record IDs, not strings**. Campaign statuses are org-defined rows, which corroborates the PRD's largest gap (Settings → General → custom Campaign Statuses) from the data side: our compile-time enum cannot represent this.
- **`campaign.refreshInterval`**: 7 · 8 · 12 · 16 · 24 · 96 · 240 · 360 · 9999 hours. Per-campaign sync cadence, operator-chosen, with 9999 as the off switch.
- **`refreshqueue.type`**: `manual` · `scheduled`, with `interval`, `forceFresh`, `addToCurrentSnapshot`, `tier`, `version`, `postCount`, `statPostCount`, `timeToComplete`.

That last type is the whole refresh architecture, and 14,264 rows of it for 506 campaigns says refreshing is the highest-volume operation in the product. `forceFresh` and `addToCurrentSnapshot` are the two knobs: whether to bypass cache, and whether the pull joins the current snapshot or starts a new one.

---

## 4. Fields that corroborate work already done

- **`heicConvert`** on 15,314 posts (82%) — CreatorCore transcodes HEIC thumbnails as a first-class step. Our HEIC decoding work has a counterpart in the reference; this is not a workaround.
- **`authorProfilePic`** on 16,390 (88%) — the post carries its own author avatar, separate from the creator record. We mirror this and prefer it in `PostsTab`, correctly.
- **`lastFresh`** on 18,654 — the "Last Updated Xh ago" freshness label.
- **`latestViews/Engagement`** on 18,620 — a denormalised fallback for when `statistic-post` is unavailable, which is exactly the type that would not extract. Worth mirroring: it is the reason CreatorCore's UI stays populated while its stats table times out.

## 5. Fields that look vestigial

Present but carrying a single distinct value across every record, i.e. never varied: `post.cpm` (12,675 records, one value), `post.budgetSetManually` (7,368, one value), `campaign.Archive`, `campaign.tempComplete`, `campaign.viewMigrateComplete`, `campaign.viewFieldsComplete`, `campaign.defaultDeliverableViewAdded`, `campaign.actionColumnAdded`. The last five read as migration flags from the vendor's own schema changes. Do not port them.

---

## 6. What this document cannot tell you

The Data API exposes four of fourteen types. Absent: creator/profile, client, list, payout, recipient, request, tracker, sound, activation-as-a-type, and `statistic-post`'s schema. Anything about those in a PRD comes from driving the UI, not from here. `statistic-post` in particular holds the per-snapshot time series behind every chart, and we have zero rows of it.
