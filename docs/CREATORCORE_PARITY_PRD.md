# CreatorCore parity PRD — kept scope

**Reference driven:** `app.creatorcore.co`, LKM agency account, 2026-08-21, headless Chromium at 1600×1000, 23 surfaces captured.
**Method:** `scripts/creatorcore/cc-ui-inventory.mjs` logs in from gitignored `.env` and walks every nav surface plus all eight campaign sub-tabs, recording every interactive control and every visible text run with its position, plus a full-page screenshot. View-only: the only clicks are navigation. Nothing in the reference org was created, edited, refreshed or deleted.
**Exhaustive control listing:** `CREATORCORE_UI_INVENTORY.md` (generated; 1,658 lines). This document is the interpretation — what each surface *is*, and what we must change.
**Data-model evidence:** `CREATORCORE_DATA_MODEL_EVIDENCE.md`.
**Supersedes for kept scope:** the clone-status claims in `CREATORCORE_FULL_PRD_2026-08-12.md`, which were ~80% inferred. Where the two disagree, this one was observed.

**Scope (Pratham, 2026-08-21):** parity for **campaigns, dashboard, activity logs, calendar, clients, trackers, creators, lists, discovery** now. Payouts, Requests, Recipients, Fan Pages and Inbox stay parked; financials come later as their own phase. Payment surfaces are described here only where they sit inside a kept surface and must be visibly absent.

---

## 0. The conflict you need to decide

**CreatorCore renders `N/A` for absent values. We now render nothing.**

Every campaign card in the reference shows `Budget N/A` and `Creators 0`. The three visible campaigns all read `Budget N/A`, and the extract confirms why: `budget` is populated on 1 of 506 campaigns. Activation rows likewise show `N/A` in their rate column.

Today's instruction — "when you have no data about it don't show even once" — is the opposite of the reference's behaviour, and both cannot be true of a pixel-perfect clone. My recommendation is to keep what we shipped: a tile that vanishes is honest, and `N/A` repeated down a column is noise. But it is a deliberate, visible divergence from CreatorCore and it is yours to confirm. Everything else in this document assumes our rule wins.

There is one place the reference is unambiguously right and we are wrong, and it is not cosmetic — see §1.

---

## 1. The real gap is data, not UI

The reference's Posts tab for campaign *RAWR!* reports:

```
Total Posts 62 · Total Views 6,539,111 · Average Post Eng Rate 7.70% · Avg. Campaign Eng Rate 9.34%
Total Engagement 610,515 · Total Likes 587,800 · Total Comments 2,479 · Total Shares 14,434 · Total Saves 5,802
```

and every post card carries views, likes, comments, shares, downloads and engagement rate.

Our database has `likesCount = 0` for 18,602 of 18,708 posts. **CreatorCore has this data; we failed to extract it.** The `statistic-post` type returned **zero rows** — its backend timed out on every page, exactly as `scripts/creatorcore/README.md` warns — and that type is where the per-post metrics live. Post rows carry only `latestViews/Engagement` as a denormalised fallback.

So the work I shipped today (dropping Likes/Comments/Eng % when a campaign has none) is correct for the data we hold and wrong as a permanent state.

### 1.1 Solved: fetch the stats by id, not by listing

The listing cannot be made to work. `GET /obj/statistic-post?limit=5&cursor=0` answers `400 Database query timeout` at every page size, every time — smaller pages do not help, because the timeout is on their side of the query.

It is also unnecessary. Every post carries `lastStatistics`, the id of its most recent stats row, and **`GET /obj/statistic-post/<id>` answers 200 immediately**. 18,660 keyed reads get the same data the listing refuses to produce.

The record carries exactly what was missing — 24 fields, of which the load-bearing ones are `views`, `likes`, `comments`, `shareCount`, `downloadCount`, `engagementRate` (a fraction: `0.1004` = 10.04%), `engagement` (their sum of likes + comments + shares + downloads), and a per-metric delta set (`viewsChange`, `likesChange`, `commentsChange`, `shareCountChange`, `downloadCountChange`, `engagementChange`).

Verified end to end before any bulk run: post `@kewbi_` returns views 592,580 · likes 57,832 · comments 209 · shares 1,083 · downloads 380 · rate 0.1004 — **identical to what CreatorCore's own Posts tab renders for that post**. So the mapping is confirmed against the reference UI, not assumed.

- `scripts/creatorcore/cc-stats-probe.mjs` — the three-request probe that established the above.
- `scripts/creatorcore/cc-fetch-stats.mjs` — the resumable bulk fetch (concurrency 4, paced, backoff; ~5.7 records/s).
- `scripts/creatorcore/cc-apply-stats.mjs` — maps onto `Post` by `ccPostId`, dry-run by default.

Two deliberate choices in the apply step. `lastSyncedAt` is set to the stats row's `Modified Date` rather than `now()`, because that is when the metric was actually measured — it makes the "Last Synced" column truthful and it is the field `lib/metricDisplay.ts` reads to tell a real zero from an unmeasured one. **Correction (audited over 9,372 fetched records, not the single post the mapping was first cross-checked on).** An earlier version of this section said the stats record has no saves field and that `Total Saves` was therefore unsourced. Wrong — the field is `saves`, and the script had been looking for `saveCount`. It is non-null on 1,151 rows (TikTok 1,055, Instagram 31, YouTube 65) and absent on the rest, which is precisely the case the provenance rule already handles. `saves → savesCount` is now mapped, so no engagement column stays permanently hidden.

Two more things the audit settled, both of which had been assumptions:

- **`engagement` is a five-term sum**, not four: likes + comments + shares + downloads, plus saves where saves exists. 8,767 rows match the four-term sum, 804 match the five-term sum, **0 match neither**. `summarizePostMetrics` now uses the five-term form, so our Total Engagement chip is their arithmetic rather than our guess.
- **`engagementRate` is exactly `engagement / views` in every row, and is not bounded by 1.0.** 116 rows exceed 1.5 and every one is genuine — a TikTok post with 2,440 views and 6,043 likes really does rate 253%, because TikTok's view count can trail its like count. So no clamping, no unit conversion, and any future "engagement rate looks impossible" report should be checked against views before it is treated as a bug.

The general lesson is worth keeping: the mapping was **verified** against the reference UI on one post, and that was enough to be confident about the field *names* and completely miss a field that was absent from that post. One cross-check validates a mapping's shape, not its coverage.

Once applied, the hidden columns reappear on their own — no UI change needed. That is the design working as intended, not a regression.

#### Done, 2026-08-21

All 18,660 records fetched (0 unavailable) and applied to 18,655 posts, 0 failures. The gap is closed:

| | before | after |
|---|---|---|
| posts with real likes | 106 | **17,580** |
| posts with a measurement timestamp | 96 | **18,654** |

The remaining 35 posts have no CreatorCore stats row at all, so they stay unmeasured — correctly, and the provenance rule keeps them from rendering a zero.

Confirmed live, and this is the part worth keeping: **the UI changed by itself.** `TUDO MUDO`, which had shown two KPI chips and eight table columns, now shows all nine chips (Avg. Post Eng Rate 12.01%, Avg. Campaign Eng Rate 6.16%, Total Engagement 329.5K) and eleven columns with LIKES, COMMENTS and ENG % back. Not one line of component code was touched between those two states. `Last Synced` reads "258d ago" rather than "just now", because `lastSyncedAt` carries the stats row's own Modified Date.

One implementation note for anyone re-running it: the apply is **not** transactional. Batching 200 Prisma updates into one interactive transaction exceeds the 5s timeout against Neon — each update is its own round trip, so the batch spends the whole budget on the network (`P2028`, 5,195ms of 5,000). Atomicity buys nothing here: the updates are independent per post and the writes are idempotent, so a partial run is fixed by running it again. It now uses bounded concurrency (20) with `Promise.allSettled` and reports failures instead of rolling back 200 good writes with one bad one.

Corollary for the schema: CreatorCore stores `viewsPullable`, `likesPullable`, `sharesPullable`, `savesPullable`, `downloadsPullable` per post. Availability is a stored fact there and an inference here (`lib/metricDisplay.ts` reads `lastSyncedAt`). Carry it explicitly.

---

## 2. Global chrome

### 2.1 Sidebar
Fixed 240px, white, four labelled groups. Active item is a solid blue pill with white text.

| Group | Items |
|---|---|
| Campaigns & Reporting | Campaigns · Activations · Calendar · Clients · Fan Pages `LEARN MORE` · Trackers |
| Creators & Pitching | Discovery · Creators · Lists |
| Financial | Payouts · Requests · Recipients |
| Settings | Connections · Settings |

Footer: circular user avatar + first name, and a notification bell.

**Ours diverges deliberately.** We add Dashboard, Deadlines and Analytics; we must keep Payouts/Requests/Recipients hidden while parked, and Fan Pages carries an upsell badge there that is meaningless for us. Group labels and the active-pill treatment should match.

**Primary colour.** The reference's primary is a saturated blue (logo, active pill, `New Campaign`, `Add Posts`). Our `--cc-primary` is `#5B5BD6`, a violet. A second accent — magenta/purple — is reserved for **Share** actions specifically. Sample the exact values off the screenshots before changing tokens; this is a real mismatch, not a rounding error.

### 2.2 Routing
Everything is one Bubble page with query state: `/dashboard?tab=<Tab>`. Confirmed tokens: `Campaigns`, `Activations`, `Calendar`, `Clients`, `FanPages`, `Trackers`, `Discovery`, `Creators`, `Lists`, `Payouts`, `Requests`, `Recipients`, `Connections`. Campaign detail is `?tab=Campaign&campaign=<id>&sub=<Sub>&current_view=<viewId>`.

Two things follow. **Saved views are URL-addressable** — `current_view` is a first-class row id, so a user's grid configuration is shareable and restorable. And `Settings` did not resolve from `?tab=Settings`; it fell back to Campaigns. Unresolved — needs one more pass.

Trackers carries its whole control state in the URL: `?tab=Trackers&sub=sound&period=7&tracker_sort_type=24hr%20Change%20%25&order=Highest`. `sub` is `sound` or `creator`, so **the creator tracker exists and renders** (37 controls, 114 text runs) — the earlier PRD marked the whole type missing.

---

## 3. Campaigns list

Header `Campaigns` (24px/700) with a live subtitle `3 Active Campaigns` that reflects the selected status tab. Top right: **New Campaign +** (solid blue) and **Folders 📁** (outlined).

Filter bar in a bordered card: `Search Campaigns` · `Campaign Status ▾` · `Team Member ▾` · `Tags ▾` · `Client ▾` · `Creation Date ▾`.

Status pills, each with its own icon and tint: `All` · `☀ Pending` · `⚡ Active` (selected, solid blue) · `✓ Complete` · `✕ Canceled`.

Each campaign is a full-width white card, not a table row: square thumbnail, title in blue bold, `Last Updated an hour ago`, then four bordered stat chips — **Budget** (icon, `N/A`), **Creators**, **Posts**, **Team** (with member avatars) — then a **status dropdown** rendered as a blue select (`In-Progress ▾`), a magenta **Share ⬆**, and a kebab.

**Gaps for us:** we render a table, not cards; we have no Folders, no Tags or Team Member filter, no per-row status dropdown, no Share, no kebab. The status pill set and their icons should match exactly. Our filter drawer already covers search/status/client/date — Tags and Team Member are new.

---

## 4. Campaign detail

Opening a campaign **replaces the global sidebar** with a campaign-scoped blue nav: Overview · Creators · Drafts · Posts · Analytics · Financials · Documents · Settings, active item a white pill. An `✕` at top right closes back to the list. Header shows the campaign title (20px/700) with its status beneath, plus **Share Campaign ⬆** (magenta) and a contextual blue primary that changes per tab (`Add Posts +` on Posts).

This full-page takeover is a different navigation model from our in-page tabs, and it is the single biggest structural difference in the product.

### 4.1 Overview
Two columns.

**Basic Info** (left): Title · Status · Folders · Client · Team Members (avatar + name) · `Select Tags` with an `Add Tag` control · **Creative Brief** (rich text; the extract shows BBCode `[color=][highlight=][url=]`) and a client-facing portal link `https://<agency>.creatorcore.co/portal?briefViewer=<campaignId>`.

**Activity** (right): a feed with an `All | Comments` filter. Event vocabulary, verbatim, each with an emoji glyph and a relative timestamp:

| Glyph | Event |
|---|---|
| ➕ | `<Creator> (@handle) has been added to the campaign by <User>` |
| 🌀 | `<Creator> (@handle) status has been changed to <Status> by <User>` |
| 🤳 | `A new post has been added by <User>` |
| 📦 | `<N> posts were added by <User>` |
| 🗑️ | `A post has been deleted by <User>` |
| 💡 | `Campaign status has been changed to <Status> by <User>` |

Activity logs are in kept scope, so **these six event types, their glyphs and their exact phrasing are a requirement**, as is the threaded-comment filter.

#### What we actually have, checked rather than assumed

The earlier version of this section said we "log audit events but do not render the feed". That understated it. Two separate models, and neither is ready:

- **`ActivityLog`** is campaign-scoped (`campaignId`, `userId`, `action`, `metadata`) — exactly the right shape for this feed — and has **zero call sites**. `grep` for `db.activityLog` across `app/`, `lib/` and `components/` returns nothing. It is a dead model that was declared and never wired.
- **`AuditLog`** is real and busy (~40 distinct actions) but **org-scoped**, keyed by `entityType`/`entityId`. Filtering it to one campaign only works where the payload happens to carry the campaign.

Mapping the six required events onto what exists:

| Glyph | Event | Source today |
|---|---|---|
| ➕ | Creator added | `activation.create` — usable: `after.campaignId` is present |
| 🌀 | Status changed | `activation.update` — **needs `campaignId`**; before/after carry only `id`, `status`, `feedbackNotes`, `postedUrl` |
| 🤳 | Post added | **nothing** |
| 📦 | N posts added | **nothing** |
| 🗑️ | Post deleted | **nothing** |
| 💡 | Campaign status changed | `campaign.update` — usable, entityId *is* the campaign |

So half the vocabulary has no source at all, and one more is unqueryable per-campaign. The feed is not a read over existing data; it needs write-path instrumentation on the post routes first. `CampaignComment` already exists, so the `All | Comments` filter is the cheap half.

Smallest honest build, in order: add `campaignId` to the `activation.update` audit payload; emit audit rows on post create, bulk create and delete; then one `GET /api/campaigns/[id]/activity` that unions the six actions with `CampaignComment` and sorts by time. Do **not** revive `ActivityLog` — `AuditLog` already holds the actor, IP and before/after that this feed's phrasing needs, and a second log would drift from it.

### 4.2 Posts
Source filter `All` / `⬆ Manual`. Nine solid-violet KPI chips in one row: Total Posts · Total Views · Average Post Eng Rate · **Avg. Campaign Eng Rate** · Total Engagement · Total Likes · Total Comments · Total Shares · Total Saves. Note the two distinct engagement rates — per-post average and campaign-wide — we have neither.

Controls: `Search By Username` · `Post Date Filter <from> — <to>` · TikTok and Instagram icon toggles · `Views/Engagement ▾` sort · grid/list view toggle.

**Default view is a card grid, not a table.** Each card is a full-bleed vertical thumbnail with the platform badge top-left and a kebab top-right; a gradient overlay at the bottom carries `@handle` then one line each for ▶ views, ♥ likes, 💬 comments, ➤ shares, ⬇ downloads, 📊 eng. rate, and a footer `Posted <date>   Last Updated <relative>`.

**Gaps:** our Posts tab is a table by default with no card grid, no username search, no date-range filter, no platform icon toggles, no Downloads or Saves anywhere, and four of the nine KPI chips missing. `Refresh Data` has no equivalent.

### 4.3 Creators, Drafts, Analytics, Financials, Documents, Settings
Captured but sparse for this campaign (12, 7, 6, 9, 3 and 7 controls respectively) — this campaign is `Complete` with no live activations, so these tabs are near-empty rather than simple. **Do not spec from this capture.** Re-drive against an active campaign before writing their requirements. Financials is out of kept scope anyway; Drafts is the known large gap and needs its own observed pass.

---

## 5. Activations

Titled **Creator Activations** with a `LEARN MORE 👀` badge. Three panels across the top: **Overview**, **In-Progress Deliverables**, **Filters** (Status, Team Member, and a `Filter` button). Big counters: `Activations 70`, and four stage counts — **Awaiting Draft**, **Awaiting Approval**, **Draft Declined & Awaiting Revision**, **Awaiting Posting**.

The list is **grouped with per-group counts**, not flat:

- `Pending (126)`
- `Invited (21)`
- `In-Progress - Empty Deliverables (10)`
- `Complete — Awaiting Payout (0)`

Columns: Creator · Last Status Change · Campaign · Status & Actions. **Row actions differ by group** — Pending/Invited rows offer `Decline/Cancel` and `Accepted`; In-Progress rows offer `Mark as Complete` and `Manage Deliverables`. Each row shows creator name, `@handle`, campaign title, a relative timestamp, and `N/A` where no rate is set.

**Gaps:** ours is a flat list with none of the grouping, no group counts, no per-group action pairs, and no `Manage Deliverables`. This is the clearest single-surface rewrite in kept scope. Note `Complete — Awaiting Payout` is a payment-adjacent group we should render as a terminal state without the payout affordance while payouts are parked.

---

## 6. Creators

Header `Creators` with `New Creator` and a `200 Creators` count. Sort control `Date Added` plus a `Filter` button. Each creator is a card row: display name, `@handle`, and exactly two stats — **Followers** and **Avg. Views** — formatted compactly (`2.22M`, `146k`).

**Correction to the earlier PRD.** It claimed per-deliverable rate-card columns (View Rate, TikTok Song Promo, IG Reel…) as first-class columns on this list. They are **not** in the default view. They may live behind `Filter`/column config, but the list as rendered shows only Followers and Avg. Views. Do not build six rate columns on that claim without re-checking.

**Gaps:** lowercase-`k`/`M` compact formatting, `Date Added` sort, and the count in the header. Our Followers column correctly hides when empty — a divergence per §0, and one the reference would render as a value.

---

## 7. Trackers

`?tab=Trackers&sub=sound|creator&period=7&tracker_sort_type=24hr Change %&order=Highest`.

Both sub-tabs render. The URL proves three controls the earlier PRD marked missing: a **period toggle** (`period=7`), a **sort type** (`24hr Change %`), and a **sort direction** (`order=Highest`). Sound tracker is the denser surface (57 controls, 234 text runs) versus creator (37, 114).

**Gaps: closed 2026-08-22.** Three of the four listed here were already built when this was written and the document had not caught up — the period toggle and the sort are both on the sounds tab, and `app/api/cron/sync-trackers` writes `SoundTrackerSnapshot` from `fetchTikTokSoundStats`, so the numbers do move. The creator tracker was the real gap and now exists: `?sub=creator` equivalent sub-tabs, 7/14/30-day periods (the reference offers no 24h here), four sorts, and the reference's two-figure card.

What it can honestly show is not what the reference shows, and the difference is data rather than design. `Creator.followersCount` is populated on 11 of 1,834 creators and `averageViews` on exactly 1, both `Float @default(0)` — so those cannot be printed as measured figures. Views can: 18,708 posts carry `postedAt` and `viewsCount` across 1,830 of the same creators. So **Avg. Views** is the mean views of a creator's posts inside the selected window, its **Change** is the same figure over the preceding window of equal length, and **Followers** shows a count only where one exists with `No data yet.` for its change — which is the string the reference itself prints in every Change cell on the captured page, for the same reason. Watchlist membership is `Creator.trackedSince`.

The requirements in `CREATORCORE_FULL_PRD_2026-08-12.md` §4.9.1–4.9.3 stand for anything follower-based, which needs a snapshot table and an ingestion path that does not exist yet.

---

## 8. Calendar, Clients, Lists, Discovery, Fan Pages

Captured (33, 26, 76, 18 and 15 controls). Lists is the richest of these and worth its own pass. Discovery opens platform-scoped at `?platform=TikTok`. Fan Pages is nearly empty — 15 controls, consistent with the nav upsell badge; low maturity in the reference too, and parked for us regardless.

These four need a narrative pass with an active data set before they can be specced properly. The exhaustive control lists are already in `CREATORCORE_UI_INVENTORY.md`.

---

## 9. Ordered plan

1. **Re-extract `statistic-post`.** Restores the metrics behind four KPI chips, three post columns and both engagement rates without touching UI. Highest value in the program (§1).
2. **Confirm the `N/A` question** (§0). It gates every "absent value" decision downstream.
3. **Sample the reference palette** off the screenshots and correct `--cc-primary` plus the Share accent (§2.1).
4. **Rewrite Activations** as grouped queues with per-group counts and per-group action pairs (§5).
5. **Campaign Overview activity feed** — six event types, exact glyphs and phrasing (§4.1).
6. **Campaign Posts** — card-grid default, the four missing KPI chips, username search, date range, platform toggles (§4.2).
7. **Campaigns list** — cards over table, Folders, Tags/Team filters, per-row status dropdown (§3).
8. ~~**Trackers** — snapshot ingestion, creator type, period toggle, velocity sort (§7).~~ **Done 2026-08-22** — three of the four were already built; the creator sub-tab shipped in 061bf4b. See §7.
9. **Re-drive Drafts, Analytics, Creators-tab, Calendar, Clients, Lists, Discovery** against an active campaign and a populated org, then spec (§4.3, §8).
10. **Resolve the Settings tab token** and inventory its seven tabs (§2.2).

## 9a. Modals, dropdowns and create flows

Captured by `scripts/creatorcore/cc-modal-inventory.mjs`, which opens each control and dismisses it with Escape without submitting. Every click target is named explicitly; a forbidden-label check runs before each click and before any step advance, and it stops rather than guesses. Nothing was created, edited or deleted.

**All create flows are single-step modals, not wizards.** Our `CampaignWizard` is five steps; the reference asks for everything on one screen.

### New Campaign
Centred modal, ~600px, dark overlay, `✕` top right.

| Field | Required | Notes |
|---|---|---|
| Title | **yes** | placeholder `Tchami - Adieu Release` |
| Client | *(Optional)* | free-text `Client Name`, not a picker |
| Brief | *(Optional)* | rich text with a full toolbar: font family, **B** *I* U S, text colour, highlight, H1–H4, ordered and unordered list, indent/outdent, align, link |
| Budget | *(Optional)* | placeholder `$5,000` |
| Enable External Rates | toggle, default off | with an ⓘ tooltip |
| Default Deliverables | *(Optional)* | a `Type` select + a name input (`GRWM`) + **Add**, plus a **Most Used** row of one-click chips (e.g. `TikTok Song Promo`) |

**CreatorCore labels Budget and Client "(Optional)" in its own create form.** That is independent confirmation of today's optional-budget work, from the reference rather than from us.

Gaps: no rich-text brief, no default deliverables, no deliverable types, no Most Used chips, no external-rates concept.

### New Client
Name (required) · Client Tags with **Add Tag** · Website URL *(Optional)* · Logo via **Search for Logo** or **Upload Thumbnail** · **Points of Contact** with **Add** (repeatable) · Notes textarea · **Create**.

Gaps: logo search, repeatable contacts, tags.

### New List
Title (`Mom Creators`) · Description *(Optional)* · **Get notifications for this list** toggle · **Create List**. The notification toggle is a per-list subscription we have no equivalent for.

### New Tracker
Returns **"Tracker Limit Reached! Reach out to your CreatorCore account manager or delete trackers."** Trackers are quota-limited per plan — a commercial constraint, and a state our tracker UI has no design for.

### Filter Creators (the richest panel in the product)
- **Tags to include** / **Tags to exclude**, each with `Add filter` and `Clear all selected tags`
- **Social Stats**: TikTok · Instagram · YouTube · **X** — a fourth platform we do not model
- **Details**: Location · Gender · Representative · Deliverable · Age · Birthday Month
- **Audience Demographics**: TikTok Top Country · Instagram Top Country · YouTube Top Country
- **Reset**

Gaps: nearly all of it. Note the creator fields this implies — gender, age, birthday month, representative, location, per-platform top country — none of which are in our `Creator` model.

### Share Campaign — per-field visibility, and it matters for handover
This is what a client sees, so it is the most delivery-relevant modal in the product. Link form is `https://<agency>.creatorcore.co/client/<slug>` — note this is a *different* surface from the brief portal (`/portal?briefViewer=<id>`).

| Group | Controls |
|---|---|
| Creator Platforms Included | TikTok · Instagram · YouTube · X |
| Creator Visibility | Hide All Creators · Show Creator Statuses · Show Rates |
| Draft Visibility | Hide All Drafts |
| Campaign Statistics | Show Total Budget · Show Reach |

Our share is all-or-nothing. Every one of those toggles is a gap, and `Show Rates` / `Show Total Budget` are exactly the switches an agency needs before sending a link to a brand.

### Campaign Status filter
Expands to the billing sub-statuses the older PRD inferred: **Need To Invoice · Invoiced · Paid · Paused**. Confirmed.

### Not resolved in this pass
`Client` and `Filters` targets were not found by exact text (they are input placeholders, not labels). The Activations `Filter` and `Status` clicks re-rendered the entire page (+378 controls) rather than opening a panel — that surface needs a different approach. No hover state, no validation message and no error state was provoked.

## 10. Honest limits

Observed at one viewport, on one account. §9a now covers the modals and create flows, opened but never submitted — so **no hover state, no validation message, no error state and no post-submit state is in this document**, and no record was created. Exercising a real create-and-delete round trip is the remaining gap there. Settings is uninventoried: `?tab=Settings` falls back to Campaigns and the sidebar click mis-targets, so its seven tabs are still unseen. Six campaign sub-tabs were captured against a campaign too quiet to spec from. Anything not in `CREATORCORE_UI_INVENTORY.md` is not evidence.
