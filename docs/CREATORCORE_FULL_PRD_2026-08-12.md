# CreatorCore — Full-Product PRD (reverse-engineered from the live app)

**Source:** driven live at `app.creatorcore.co`, logged in as Pratham's LKM-agency reference account (9 live campaigns, 200 creators, 418 payout txns, 93 trackers), 2026-08-12.
**Method:** every nav surface + every campaign sub-tab visited and DOM-inventoried. View-only; no reference data mutated.
**Purpose:** define "complete CreatorCore functionality" from the reference itself, and give each capability a build-status vs our clone (`webapp/`). Supersedes the nav-level `docs/CREATORCORE_FUNCTIONALITY_BENCHMARK.md` (2026-08-08) with field/workflow depth. Complements `docs/PRD_2026-08-12.md` (that one is "what to build next"; this one is "what the product IS").

Status legend: **✅ built** · **◐ partial** · **✗ missing** · **➕ clone-only extra** (we have it, CC doesn't). Clone status is verified where noted, else inferred from the benchmark + `RBAC_SWEEP_MAP` + platform map read this session — treat ◐/✗ as ~80% until a code read confirms.

---

## 1. What CreatorCore is

A multi-tenant SaaS for **influencer-marketing agencies and music labels** to run the full creator-campaign lifecycle: **discover** creators → **shortlist/pitch** → **activate** (brief → draft → approve → post) → **auto-track** post performance → **report** to the client → **pay** the creator. Plus a **social-listening** layer (viral TikTok-sound + creator-growth trackers) that is the music-label wedge.

**Architecture facts (verified this session):**
- Built on **Bubble.io** (no-code): `/elasticsearch/*`, `/apiservice/doapicallfromserver`, `/workflow/start`, `cdn.bubble.io`.
- **First-party data pipeline** — creator/post/sound metrics come from CreatorCore's own `tracker.creatorcore.co` backend (API `api.tracker.creatorcore.co`, CDN `prod-cdn.tracker.creatorcore.co`), **not** a resold provider (Phyllo/Modash/etc. — zero third-party signatures found). Discovery searches their own ElasticSearch of pre-scraped profiles.
- **Multi-tenant**, **seat-limited** (reference org capped 5/5 users).
- **White-label**: each agency gets a branded client portal subdomain (reference = `lkay.creatorcore.co`).
- Third-party services in play: **Rupt** (`api.rupt.dev`, account-sharing/device fraud), **Pylon** (`usepylon.com`, support chat), **Slack** (notifications integration).

---

## 2. Personas

| Persona | Needs |
|---|---|
| **Agency owner / admin** | Full control; team/roles; billing; branding; org-wide pipeline & financial visibility |
| **Account manager / campaign manager** | Run campaigns, pitch creators, chase drafts, approve content, report to client |
| **Finance / ops** | Fund balance, pay creators, track requests, invoice clients, per-campaign P&L |
| **Music label** | Track viral sound spread + creator growth; run seeding campaigns at scale |
| **Client (brand/label contact)** | Read-only branded portal: creative brief + live performance report |
| **Creator** (implied, via portal/requests) | See what's licensed/owed; submit drafts; request payout |

---

## 3. Information architecture (nav map)

```
Campaigns & Reporting:  Campaigns · Activations · Calendar · Clients · Fan Pages · Trackers
Creators & Pitching:    Discovery · Creators · Lists
Financial:              Payouts · Requests · Recipients
Settings:               Connections · Settings (General/Branding/Team/Integrations/Account/Notifications/Stories)
Campaign detail tabs:   Overview · Creators · Drafts · Posts · Analytics · Financials · Documents · Settings
```

---

## 4. Functional requirements by module

### 4.1 Discovery  ✅ built (◐ depth)
AI natural-language creator search over CreatorCore's first-party creator DB.
- **NL query** ("fitness creators", "Athletes that like country music", "Couples with a car"); marked **BETA**.
- **Platform toggle** (TikTok / Instagram / YouTube).
- **AI feedback** 👍/👎 on result relevance.
- **Filters**: Social Platform · Followers Range (min/max) · Average Views (min/max) · Engagement Rate · Countries · Languages · Management Preferences · Fan Pages · "Show Creators with Email Only".
- **Result card**: country flag, name, @handle, bio, **auto-extracted contact email**, **auto-parsed brand/discount codes** from bio, Followers, Avg. Views, **Add Creator** (→ roster/list).
- *Req:* search must run over a pre-ingested profile index (not live per-query), return the card fields above, and support one-click add-to-roster.

### 4.2 Creators (roster / CRM)  ✅ built
The agency's owned creator database.
- **New Creator**, **CSV Import**, **Filter**, count badge.
- Per-creator **rate card by deliverable type** as first-class columns: **View Rate, TikTok Song Promo, TikTok Brand Promo, IG Feed Post, IG Story, IG Reel**, Date Added, plus name/@handle/Followers/Avg. Views.
- Creator detail: social accounts, tags, flags, history (inferred).
- *Req:* creators carry per-deliverable pricing; bulk CSV import; taggable/flaggable (see 4.13).

### 4.3 Lists  ✅ built
Curated creator shortlists.
- **New List**; each list = name, updated-at, **+N Creators**, **Share** (external client-facing).
- *Req:* group creators into named lists, share a read-only public link (pitch/roster share).

### 4.4 Campaigns — list  ✅ built
- **New Campaign**, **Folders** (grouping), search, count.
- **Filters**: Campaign Status, Team Member, Tags, Client; **sort** by Creation Date.
- **Status tabs**: All · Pending · Active · Complete · Canceled.
- **Card**: title, last-updated, Budget, Creators #, Posts #, Team #, status pill, **Share**, kebab.
- Billing sub-status pipeline: Active → {In-Progress, Need To Invoice, Invoiced, Paid}; Canceled → {Paused, Canceled}.

### 4.5 Campaigns — detail (the core loop)  ✅/◐
URL `?tab=Campaign&campaign=<id>&sub=<Tab>`. Tabs:

- **Overview** ✅ — Basic Info (Title, Status, Folders, **Client**, **Team Members**, **Tags**); **Creative Brief** (rich text) with a **client-facing portal link** (`<agency>.creatorcore.co/portal?briefViewer=<id>`); right-rail **Activity feed** (system events + threaded comments, All/Comments filter); **Share Campaign**.
- **Creators** ✅ — configurable **data grid** of campaign creators: Add Creator, Search, **New View** (saved views), **Filtering / Sorting / Grouping / Add Columns**, **Deliverables** tracking. Airtable-like, not a fixed table.
- **Drafts** ◐ — creator draft-content approval step (submit → review → approve/decline → post). **The pitch→paid loop the product sells; our clone's biggest gap.**
- **Posts** ✅ — auto-tracking reporting core: **Add Posts** (paste URLs), **Refresh Data** (re-sync), source filter All/Manual, date filter. **Aggregate KPIs**: Total Posts, Total Views, Avg Post Eng Rate, Avg Campaign Eng Rate, Total Engagement/Likes/Comments/Shares/Saves/Downloads. **Per-post**: @handle, views/likes/comments/shares/saves/downloads/eng-rate, posted date, freshness ("Last Updated Xh ago"), **dead-link detection**.
- **Analytics** ✅ — **customizable modular dashboard** (**Add Module**): Post Performance scorecards, Views/Engagement chart, Posts chart, **TikTok Audio module** (Audio Uses, Videos Added, Audio Usage Velocity).
- **Financials** ✅ — per-campaign P&L: Budget & Overview (Total Budget, Notes, **Creator Rate Totals**, **Total Profit**), **Payments** (money in from client, Add Payment), **Payouts** (money out to creators, Add Payout).
- **Documents** ✗/◐ — per-campaign contracts/file storage.
- **Settings** ✅ — campaign-level config (status, client, team, delete).

### 4.6 Activations  ✅ built
Org-wide **creator-deliverable pipeline** (the Drafts workflow across all campaigns).
- Count of in-progress; **stage counters**: Awaiting Draft → Awaiting Approval → Draft Declined & Awaiting Revision → Awaiting Posting (→ Posted/Complete).
- Filters: Status, Team Member. Columns: Creator, Last Status Change, Campaign, Status & Actions. Primary/Secondary activation types.
- *Req:* a single work-queue answering "who owes a draft / whose draft needs approval / who must post."

### 4.7 Calendar  ✅ built
**Deliverables Calendar**: Week/Month, Today nav, filter by Team Member; plots deliverable due-dates.

### 4.8 Clients (buy-side CRM)  ✅ built
- **New Client**; per client: **Contacts** #, **Campaigns** #, Tags, Recent Campaign.
- Client links to campaigns + the branded brief/report portal.

### 4.9 Trackers (social listening, BETA)  ◐ half-built, time series is inert
- **New Tracker**; two types: **Audios** and **Creators**.
- **Audio/Sound tracker** (music-label wedge): per sound — name, artist(s), **Audio Uses** (total videos, e.g. 863,958), **Change %**, **24H Added**, period toggle 24hr/7/14/30d, sort by velocity.
- **Creator tracker**: creator growth over time.
- *Req:* time-series ingestion of sound-usage + creator metrics; velocity/delta surfacing.

> A **Tracker** is a *subject you monitor over time*. It is not the metered polling
> slot that rations post syncing — that is `SyncSlot`. Two different things; do not
> merge them because both poll.

**Clone status, measured 2026-08-14 (not inherited from the benchmark):**

| Piece | State |
|---|---|
| `TikTokSound` + `SoundTrackerSnapshot` models | ✅ exist |
| `/api/trackers` GET/POST, `/api/trackers/[id]` DELETE | ✅ exist, orgId-scoped |
| `/trackers` page — list, add, delete, status badge | ✅ exists |
| `velocityScore` → status (viral/trending/stable/declining) | ✅ computed on read |
| **Snapshot ingestion** | ✗ **nothing writes `SoundTrackerSnapshot` outside `prisma/seed.ts`** |
| Period toggle 24hr/7/14/30d | ✗ |
| Sort by velocity | ✗ |
| **Creator tracker (whole type)** | ✗ |

The consequence of row 5: on any seeded environment the sound tracker renders
convincing numbers that **never move**, because the only writer is the seed. In
production it renders nothing at all. It reads as built and is not.

**4.9.1 Audio/Sound tracker — requirements**
- Per tracked sound, one snapshot per ingestion run: `usesCount` (total videos using the sound), `videosAdded24h`, `deltaUses24h`, `velocityScore`, `recordedAt`.
- Deltas are derived from the previous snapshot, never trusted from the source.
- `velocityScore` = videos added per hour since the previous snapshot, normalised so a period toggle can re-rank without re-fetching.
- Period toggle recomputes Change % and Added over the selected window from stored snapshots; it must not require a fresh fetch.
- A sound with a single snapshot shows Uses but "—" for Change % and velocity. Do not render 0% for unknown.

**4.9.2 Creator tracker — requirements**
- Subject is a creator handle on a platform, independent of whether that creator is on the org's roster or in any campaign.
- Snapshot fields: `followersCount`, `followingCount`, `postsCount`, `avgViews`, `engagementRate`, `recordedAt`.
- Same delta/velocity/period semantics as 4.9.1, over followers rather than uses.
- Sources, in authority order, reusing the existing fetchers rather than a new scraper: connected-creator official APIs → Instagram Business Discovery (token is live in prod) → YouTube Data API → TikTok direct page parse. Falls to "no data" rather than a stub.

**4.9.3 Shared**
- Both types live under one `/trackers` route with an Audios | Creators tab split, matching the reference's single "New Tracker" entry point.
- Both are org-scoped on every read and write; a tracker id from another org returns 404.
- Ingestion is a sweep like post sync, and is **settlement-class, not slot-metered** — tracking a sound is a listening cost, not a per-post billable, so it must never consume `SyncSlot` capacity.

**Ingestion feasibility note.** §8 rules out replicating CC's scraper, and this does
not: sound-usage counts come from the same TikTok page payload the post fetcher
already parses, and creator follower counts come from APIs we already call. The
open risk is not technical, it is egress — TikTok is DNS-sinkholed from Indian
ISPs, so ingestion only works from `iad1` (Vercel) or another non-India host,
never from a local dev sweep.

### 4.10 Fan Pages  ◐ (nascent)
Shareable public page feature (renders a Reports/public-page surface, **Copy URL**, currently empty). Upsell "LEARN MORE" in nav. Low-maturity even in the reference.

### 4.11 Financial — Payouts / Requests / Recipients  ✅ built
- **Payouts**: wallet/ledger — named **Balances**, **Add Funds**, **New Payout**, **New Recipient**, **Export Data**; **Transactions** ledger (filter Status/Type/Date; search Creator/Username/Campaign/Amount/Notes; row = time, creator, amount, status, deposited-date, running balance).
- **Requests**: creator/manager **payout-request queue** → agency **Pay**; metrics (Outstanding total, Average Request Time); filter by Manager/Paid/Unpaid.
- **Recipients**: payee directory (76) — Creator or Organization, Active status, **Pay**, search by name/username/company. (KYC/payout accounts.)

### 4.12 Reports & Media Kits  ◐
Referenced as first-class in role descriptions ("campaigns, creators, **media kits**") and via the client-facing report/brief portal + list/campaign **Share** links. The client portal delivers a live branded performance report keyed by share token.

### 4.13 Connections (CreatorConnect)  ➕/◐
Cross-agency **B2B partner network** (not platform OAuth): **New Connection**, **Share Connection** — connect with partner agencies, share creator rosters (live access), let partners import your campaign data.

### 4.14 Settings  ✅/◐

CreatorCore splits settings into seven tabs. Ours has four linked entries
(Profile · Team · API Keys · Billing) plus an **unlinked** `/settings/ingestion`.
Tab by tab, and what each one costs us:

| CreatorCore tab | What it holds | Our state |
|---|---|---|
| **General** | Taxonomy the org defines for itself: **Creator Tags**, **Creator Flags** (⚡ Fast Turnaround / 👀 Good Views / 🚫 Not Responding / ⏸️ On Break), **Campaign Tags**, custom **Deliverable Types**, custom **Campaign Statuses** (with billing sub-statuses), custom **Activation Statuses** | ✗ **absent** — our statuses and flags are compile-time enums in `schema.prisma`; an org cannot add one |
| **Branding** | White-label logo/colours + client-portal subdomain | ✅ **built, misfiled** — every field (`logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`, `fontFamily`, `brandName`, `customDomain`, `faviconUrl`) lives on `/settings/profile` and writes through `PATCH /api/org` |
| **Team** | **Invite New User**, seat-limited (5/5); roles Admin / Member / View Only; scope permission **View All Campaigns** vs **View Assigned Only** | ✅ built — `UserInvite` + 5 roles (OWNER/ADMIN/MANAGER/MEMBER/VIEWER). ✗ **no seat limit**, ✗ **no assigned-only scope** |
| **Integrations** | **Slack** only | ✗ absent |
| **Account** | Personal profile | ✅ built — but merged into the same `/settings/profile` page as org branding, so "my name" and "the org's brand colour" sit in one form |
| **Notifications** | Per-user notification preferences | ✗ absent — we send mail with no preference surface |
| **Stories** | IG-story tracking (inferred; never opened) | ✗ absent, and **unspecified** |

**Requirements this creates for us**

1. **Org-defined option sets** — the largest gap. Creator Tags, Creator Flags, Campaign
   Tags, Deliverable Types, Campaign Statuses and Activation Statuses must become
   org-scoped rows with a Settings → General editor. Every status enum is load-bearing in
   queries today (`status: { in: [...] }` in the sync cron, the campaign status tabs), so
   this is a data-model change wearing a UI change's clothes — sequence it deliberately.
2. **Split `/settings/profile` into Account and Branding.** One form mixes personal
   identity with org white-labelling, and the two want different permissions:
   `org:settings` gates the second, nothing gates the first.
3. **Seat limits on Team**, enforced at invite time and surfaced as `n/N`. Pairs with the
   existing `Plan`/entitlements system rather than needing new billing machinery.
4. **Assigned-only campaign scope.** RBAC has roles but no row-level scope — a MEMBER
   currently sees every campaign in the org.
5. **Notification preferences**, per user, per channel.
6. **Link or delete `/settings/ingestion`** — it is reachable only by typing the URL.
7. **Slack integration** and **Stories** — deferred. Stories has no specification at all.

> **Verification status.** The tab list and the General/Team contents came from an earlier
> logged-in session. Field-level detail inside **Integrations, Notifications and Stories is
> unverified** — those three need a fresh pass through the live app (`app.creatorcore.co`,
> a Bubble.io front end) before we commit to building them.

---

## 5. Cross-cutting requirements

| Concern | Requirement (from reference) |
|---|---|
| **Multi-tenancy** | Every object scoped to org; seat-limited plans |
| **RBAC** | 3 roles (Admin/Member/View-Only) × campaign-scope (All vs Assigned) |
| **White-label portals** | Per-agency subdomain; branded brief-viewer + report pages for clients |
| **Sharing / public tokens** | Campaigns, Lists, Reports, Connections all expose read-only shareable URLs |
| **Activity / audit** | Per-campaign activity feed (system events + threaded comments + emoji) |
| **Data freshness** | Posts/trackers auto-synced from first-party pipeline; "Last Updated Xh ago"; manual **Refresh Data**; dead-link detection |
| **Notifications** | In-app bell + Slack integration |
| **Customization** | Custom tags/flags/deliverable-types/statuses per org (Bubble option-sets) |
| **Financial integrity** | Balance ledger with running balance, statuses (Success), export |

---

## 6. Core data model (entities inferred)

`Organization` (plan/seats/branding/subdomain) · `User`(role, scope) · `Creator`(handle, platform, followers, avgViews, **rateCard{deliverableType→price}**, tags, flags, contactEmail) · `List`(creators, shareToken) · `Client`(contacts, campaigns) · `Campaign`(status+substatus, client, team, tags, brief, budget, shareToken) · `Activation`(creator×campaign, deliverables, pipeline status) · `Deliverable`(type, due date) · `Post`(url, platform, metrics{views,likes,comments,shares,saves,downloads,engRate}, snapshots, freshness, deadFlag) · `AnalyticsModule` · `SoundTracker`/`CreatorTracker`(time-series) · `Payment`(client→agency) · `Payout`(agency→creator) · `Recipient`(payee, active) · `Balance`(ledger) · `PayoutRequest` · `Report`/`MediaKit`(shareToken) · `Connection`(cross-org) · custom `Tag`/`Flag`/`DeliverableType`/`CampaignStatus`/`ActivationStatus` option-sets · `ActivityEvent`/`Comment`.

---

## 7. Gap analysis vs our clone (`webapp/`)

**At/above parity (keep):** Campaigns list+detail (Overview/Creators/Posts/Analytics/Financials/Settings), Discovery, Creators CRM, Lists, Activations, Calendar, Clients, Payouts/Requests/Recipients, RBAC roles.

> Corrected 2026-08-14: "Trackers spine" was previously listed at parity. It is not
> — see §4.9. The models and CRUD exist, but nothing writes a snapshot outside the
> seed, so the time series is inert, and the Creators tracker type does not exist
> at all. Moved to the gap list below.

> Corrected 2026-08-15: "Settings taxonomy" was previously listed at parity. It is
> not — see §4.14. CreatorCore lets an org define its own creator tags, creator
> flags, campaign tags, deliverable types, campaign statuses and activation
> statuses; ours are compile-time Prisma enums that no org can add to. "RBAC" was
> narrowed to "RBAC roles": we have the five roles but neither the seat limit nor
> the assigned-only campaign scope. Both moved to the gap list below.
**Clone-only extras (differentiators — feature, don't hide):** marketplace/money surfaces (Negotiations, Proposals, Deposits, PayoutRequests, Reviews, MarketplaceAnalytics), plus admin/analytics/audit-log/deadlines/inbox/media-kits/plans/reports pages.

**Real gaps to close for CreatorCore parity:**
1. **Drafts / draft-approval step** ✗ — the on-message "no more chasing screenshots" loop (creator submits draft → approve/decline → revision → post). Our clone jumps Creators→Posts. **Highest-value gap.**
2. **Documents tab** ✗ — per-campaign contract/file storage.
3. **Campaign Analytics "Add Module"** ◐ — modular, composable dashboard vs fixed charts.
4. **Creators-tab configurable grid** ◐ — saved Views / custom Columns / Grouping (Airtable-style).
5. **Client brief-viewer portal link** ◐ — brief as a shareable client page, not just an internal field.
6. **Custom option-sets in Settings** ✗ — org-defined creator tags / creator flags / campaign tags / deliverable types / campaign statuses / activation statuses. Marked ◐ before; nothing exists, because these are Prisma enums. A data-model change, not a UI one — the status enums are load-bearing in live queries. Detail in §4.14.
7. **CreatorConnect** ◐ — cross-agency roster/campaign sharing.
8. **Assigned-only campaign scope** ✗ — a MEMBER sees every campaign in the org; CC scopes to assigned campaigns. The one settings gap that is a *tenancy* gap, not a convenience one.
9. **Notification preferences** ✗ — we mail users with no way for them to opt out.
10. **Account / Branding split** ◐ — one `/settings/profile` form mixes personal identity with org white-labelling; they want different permissions. §4.14.
11. **Slack integration**, **Fan Pages**, **seat-limit enforcement**, **Stories** ✗ — lower priority; Stories is entirely unspecified.
12. **Trackers — both types** ◐/✗ — sound-tracker snapshot ingestion does not exist (seed-only writer), and the Creators tracker type is absent. This is the music-label wedge, so a label evaluating us sees a listening feature whose numbers never change. Detail and build order in §4.9.

**Note on platform coverage:** CC's tracked platforms are effectively TikTok + Instagram (+ YouTube). Our registry now spans 10 platforms (schema enum extended this session) — an expansion *past* CC, gated on which platforms get real fetchers (free-first: YT/Meta/Twitch/Pinterest; manual: X/Snap/LinkedIn).

---

## 8. Out of scope / open questions
- Exact `Stories` settings behavior (not opened).
- Whether Documents supports e-sign (appears to be storage only).
- Fan Pages' intended final shape (nascent in the reference too).
- Upstream of `tracker.creatorcore.co` — how CC sources raw TikTok/IG data is server-side and unobservable; **do not attempt to replicate their scraper** (months of work + ToS risk). Discovery-grade metrics for non-connected creators is the one thing free APIs can't give us → a paid unified provider (Phyllo ~$199/mo) is the only slot-in, and stays gated for spend approval.

*Confidence: CreatorCore surface coverage ~92/100 (every nav item + campaign sub-tab visited live; a few tabs were empty on the reference so some field lists are partial). Clone-status column ~80/100 (from benchmark + maps, not a fresh full code read).*
