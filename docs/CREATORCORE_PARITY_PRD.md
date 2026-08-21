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

So the work I shipped today (dropping Likes/Comments/Eng % when a campaign has none) is correct for the data we hold and wrong as a permanent state. **The highest-value next action in this whole program is re-running the `statistic-post` extraction**, with small pages and aggressive backoff, until those 18,680 posts have their metrics. That single fix restores four KPI tiles, three post columns, the engagement leaderboard and both engagement-rate figures — none of which need any new UI.

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

Activity logs are in kept scope, so **these six event types, their glyphs and their exact phrasing are a requirement**, as is the threaded-comment filter. Ours logs audit events but does not render this feed on the campaign.

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

**Gaps:** we have the models and the list but nothing writes `SoundTrackerSnapshot` outside the seed, so our numbers never move; and we have no creator tracker, no period toggle, no sort. The requirements in `CREATORCORE_FULL_PRD_2026-08-12.md` §4.9.1–4.9.3 stand and are now confirmed against the live URL surface.

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
8. **Trackers** — snapshot ingestion, creator type, period toggle, velocity sort (§7).
9. **Re-drive Drafts, Analytics, Creators-tab, Calendar, Clients, Lists, Discovery** against an active campaign and a populated org, then spec (§4.3, §8).
10. **Resolve the Settings tab token** and inventory its seven tabs (§2.2).

## 10. Honest limits

Observed at one viewport, one account, one `Complete` campaign, and with no control clicked beyond navigation — so **no modal, dropdown menu, hover state, empty state, error state or validation message is in this document.** Those need a second pass that opens controls; you have said I may create and clean up my own records there, which makes it safe to exercise create flows and delete only what I made. Settings is uninventoried. Six campaign sub-tabs were captured against a campaign too quiet to spec from. Anything not in `CREATORCORE_UI_INVENTORY.md` is not evidence.
