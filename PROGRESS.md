# PROGRESS.md — Implementation Tracker

> **Agent instructions:** Read this file to understand what's done and what to work on next.
> When you complete a task, update this file — move items from ⏳ to ✅, add notes.

---

## Current Status

**Phase:** Phase 4 — Feature Completion
**Last updated:** 2026-03-30
**App URL:** http://localhost:3009
**Login:** admin@demo.com / admin123
**DB:** Neon PostgreSQL (serverless) — seeded with 5 clients, 10 creators, 5 campaigns, activations, payouts

---

## Phase 1 — Foundation ✅ COMPLETE

- [x] Next.js 16 app scaffold (App Router, TypeScript, Tailwind)
- [x] Prisma 7 schema — full multi-tenant data model
- [x] NextAuth v5 credentials login
- [x] Multi-tenant architecture (orgId on all models)
- [x] Seed script (`prisma/seed.ts`) — creates admin@demo.com / admin123
- [x] Auth middleware (`proxy.ts`)
- [x] Basic page routing for all sections

---

## Phase 2 — UI Design (matching real CreatorCore) ✅ COMPLETE

### Design System
- [x] `globals.css` — full light theme CSS variables
- [x] Font: Inter from Google Fonts
- [x] Color tokens: `--cc-bg`, `--cc-card`, `--cc-border`, `--cc-primary`, `--cc-text`, `--cc-text-muted`

### Layout
- [x] `NewSidebar.tsx` — white sidebar, grouped nav sections, purple active pill, org badge (LKM), user avatar + name at bottom
- [x] `TopBar.tsx` — light top bar with breadcrumb navigation
- [x] `(dashboard)/layout.tsx` — sidebar + topbar wrapper, light bg

### Pages (all light-themed)
- [x] **Login** — purple gradient bg, white card, email/password form, NextAuth integration
- [x] **Dashboard** — stat cards (Active Campaigns, Active Creators, Pending Payouts, Growth), Recent Campaigns table, Activity Feed, Recharts chart
- [x] **Campaigns list** — header, search bar, filter dropdowns (Status/Team/Tags/Client/Date), status tab pills (colored per status), campaign rows with album art + stats + status badge + Share + kebab
- [x] **Campaign detail** (`/campaigns/[id]`) — light theme, tabs (Overview, Creators, Posts, etc.)
- [x] **Creators list** — search, grid/table toggle, empty state, Add Creator button
- [x] **Creator detail** (`/creators/[id]`) — light theme
- [x] **Clients list** — stat cards, client rows, light table
- [x] **Client detail** (`/clients/[id]`) — light theme
- [x] **Payouts** — list, light table
- [x] **Activations** — light theme
- [x] **Lists** — light theme
- [x] **Discovery** — light theme
- [x] **Calendar** — light theme
- [x] **Trackers** — light theme
- [x] **Requests** — light theme
- [x] **Recipients** — placeholder
- [x] **Connections** — light theme
- [x] **Media Kits** — light theme
- [x] **Reports** — light theme
- [x] **Fan Pages** — placeholder (was 404, now shows "Coming Soon")

### UI Details Fixed
- [x] "New Campaign +" → outlined button (white bg, purple border)
- [x] "Folders" → solid dark navy `#1E1B4B`
- [x] Status tabs → each has unique color (Pending=amber, Active=indigo, Complete=green, Canceled=red)
- [x] Share button → solid dark navy pill
- [x] Campaign row stats → emoji labels + green dot for Team
- [x] Sidebar inactive items → `#6B7280` gray
- [x] Recharts chart sizing → `height={200} minWidth={0}`

### Plans System (custom feature — not in real app)
- [x] `lib/features.ts` — 10 typed feature flags
- [x] Prisma schema — `Plan` model, `Client.planId`, `Client.featureOverrides`, `Organization.plans`
- [x] API routes: `GET/POST /api/plans`, `GET/PATCH/DELETE /api/plans/[id]`, `PATCH /api/clients/[id]/plan`
- [x] Plans list page (`/plans`)
- [x] Plans new/edit page (`/plans/new`, `/plans/[id]`)
- [x] Client plan assignment UI on client detail page

---

## Phase 3 — Real Data Integration ✅ FORMS DONE

### Rich Seed Data ✅
- [x] 5 clients seeded
- [x] 10 creators seeded
- [x] 5 campaigns: LEAK IT (BTS), FUJI KAZE (2ND PHASE), Blessing Jolie, CRUEL WORLD, American Girls
- [x] Activations + payouts seeded

### Create/Edit Forms ✅
- [x] **New Campaign modal** (`components/modals/NewCampaignModal.tsx`) — wired to campaigns page
- [x] **Add Creator modal** (`components/modals/AddCreatorModal.tsx`) — wired to creators page
- [x] **Add Client modal** (`components/modals/AddClientModal.tsx`) — wired to clients page
- [x] **Add Payout modal** (`components/modals/AddPayoutModal.tsx`) — wired to payouts page

---

## Phase 4 — Feature Completion ⏳ IN PROGRESS

### Campaign Detail Page
- [x] Wire up Creators tab — show assigned creators (activations)
- [x] Wire up Posts tab — show campaign deliverables (with creator names)
- [x] Wire up Budget tab — show budget breakdown (CampaignFinancials seeded)
- [x] Add creator to campaign (activation creation via modal)
- [x] Multi-tenancy fix — orgId filter on GET/PATCH/DELETE
- [x] Seed data: 9 posts + 4 campaign financials
- [x] Campaign edit form (Edit tab: title, status, budget, currency, client, notes)

### Creator Detail Page
- [x] Creator stats display (followers, engagement rate, total earnings, avg engagement)
- [x] Campaign history (which campaigns they've been in — via activations)
- [x] Edit creator form (modal with name, handle, platform, bio, email, rate, notes)
- [x] PATCH route security fix (orgId filter + Zod validation)
- [x] 14 integration tests for creator detail (creatorsDetail.test.ts)
- [x] Full responsive design (mobile/tablet/iPad/desktop breakpoints)
- [x] UI bug fixes (double @@ handle, stat overflow, modal padding)

### Client Detail Page
- [x] Edit client form (name, contactPerson, email, phone, industry, website, notes)
- [x] Campaign history tab (fetches and displays linked campaigns)
- [x] PATCH route hardened — Zod validation, try/catch, orgId filter
- [x] 14 integration tests (clientDetail.test.ts)

### Payouts
- [x] Add payout form (AddPayoutModal wired)
- [x] Payout status management — "Mark Paid" (PENDING→SUCCESS direct), "→ Processing", bulk actions
- [x] Bulk payout marking (bulk route + UI)
- [x] PATCH route hardened with Zod validation

### Activations
- [x] List of all creator-campaign assignments (Kanban board)
- [x] Assignment management (status state machine via PATCH)
- [x] Security hardened — orgId filter on GET/POST, Zod on PATCH
- [x] 19 integration tests (GET, POST, PATCH, DELETE)

### Discovery
- [x] Creator search/filter system
- [x] Add to list functionality
- [x] Feature-gated behind `creator_discovery` entitlement (403 + disabled UI)
- [x] Advanced filters — niche multi-select, follower range, rate range, case-insensitive search, pagination, active filter chips (16 tests)

### Portal Marketplace
- [x] Campaign type filter pills (Budget/View-Based/Community/Private)
- [x] Budget range filter (min/max)
- [x] Sort options (newest, budget high/low, most proposals)
- [x] Pagination controls
- [x] 17 integration tests (portalDiscover.test.ts)

### View-Based Campaigns (Ledger + Fraud Detection)
- [x] Schema: `ViewLedger` model — per-post view snapshots with CPM, deltas, cumulative earnings, cap
- [x] Schema: `ViewFraudFlag` model + `FraudFlagType`/`FraudFlagSeverity` enums
- [x] `lib/fraud-detection.ts` — VIEW_SPIKE, LOW_ENGAGEMENT, BOT_PATTERN detection rules
- [x] GET/POST `/api/campaigns/[id]/view-ledger` — record & retrieve view ledger entries
- [x] GET `/api/campaigns/[id]/payout-calculator` — per-creator payout summaries for VIEW_BASED campaigns
- [x] POST `/api/campaigns/[id]/fraud-scan` — automated fraud analysis
- [x] GET `/api/campaigns/[id]/fraud-flags` — list flags with resolved filter
- [x] PATCH `/api/fraud-flags/[id]` — resolve/unresolve fraud flags
- [x] 18 integration tests (viewLedger.test.ts + viewFraudDetection.test.ts)

### Campaign Payment & Posts System (Phase A schema landed)
- [x] Schema: `PaymentMode`, `PaymentRelease`, `PostApprovalMode`, `DepositStatus` enums on Campaign
- [x] Schema: `PostStatus`, `MediaType` on Post; `activationId` FK
- [x] Schema: `CampaignDeposit` model (Razorpay/Stripe deposit tracking)
- [x] Schema: `PayoutRequest` model (creator-initiated payout requests)
- [x] Schema: `NegotiationOffer` model (negotiated rate campaigns)
- [x] Schema: `CampaignInvite` model (invite creators via DM or link)
- [x] Extended `PaymentMethod` enum: UPI, NEFT, IMPS, RTGS, ENACH, WIRE
- [x] Campaign creation wizard (5-step: CampaignWizard.tsx — basic → type → payment → payout → settings)
- [x] Campaign posts tab (PostsTab.tsx — grid/list, URL submission, approve/reject workflow)
- [x] Payment deposit UI (DepositsSection.tsx — create deposits, release, status tracking)
- [x] Creator invite system (InvitesSection.tsx — send invites, track acceptance)
- [x] Creator portal — auth (login/register), dashboard, discover, proposals, settings, payout requests, nav bar

### Trackers (TikTok Sounds)
- [x] GET/POST `/api/trackers` + GET/DELETE `/api/trackers/[id]`
- [x] Trackers page wired to real API (stat cards, track/delete, loading/empty states)
- [x] Seed data: 3 sounds with 7-day snapshots
- [x] 10 integration tests (trackers.test.ts)

### Payout Requests (standalone)
- [x] GET `/api/payout-requests` — org-level aggregate across campaigns
- [x] Requests page wired to real API (stat cards, status tabs, approve/reject)
- [x] 6 integration tests (payoutRequestsStandalone.test.ts)

### Creator Portal
- [x] Auth: login/register/logout with cookie-based sessions
- [x] Dashboard page (stats, accepted proposals)
- [x] Discover page (browse public campaigns)
- [x] Proposals page (submit/withdraw proposals)
- [x] Settings page (profile edit, niches, bank details) + PATCH `/api/portal/me`
- [x] Payout Requests page + GET/POST `/api/portal/payout-requests`
- [x] Portal nav bar (horizontal, active link highlighting, logout)
- [x] Seed: 2 CreatorUser accounts (creator@demo.com / creator123)
- [x] 9 integration tests (portalProfile + portalPayoutRequests)

### Lists
- [x] Create new list
- [x] Add creators to list

### Calendar
- [x] Calendar API (GET /api/calendar — campaigns + activations by month)
- [x] Calendar UI (month view, event dots, sidebar details)
- [x] Deadline tracking — `/deadlines` page, GET `/api/deadlines`, inline date editing, 9 integration tests
- [x] Org profile page — `/settings/profile`, GET/PATCH `/api/org`, 4 sections (General/Domain/Branding/Bank), 8 integration tests
- [x] Org financial reports — `/financial-reports`, GET `/api/financial-reports`, period comparison (6 periods), monthly trend chart, CSV export, 8 integration tests

### Connections
- [x] Platform connections page — wired to real data via `Organization.uiConfig`, connect/disconnect modals, 11 platforms (5 social + 3 messaging: WhatsApp/Telegram/Discord + 3 payment), 10 integration tests
- [x] API key management — create/list/revoke + usage instructions (curl, MCP config, Discord bot note)

### API Key Authentication (Session 12)
- [x] `lib/authenticate.ts` — shared auth utility: NextAuth session first, then `Bearer oai_*` API key (SHA-256 hash lookup + lastUsedAt update)
- [x] All 24 org-scoped API routes updated to use `authenticateRequest(req)` — API keys work for every endpoint
- [x] `getAuditActor(result)` helper for audit logging compatibility with API key requests
- [x] 12 integration tests (`apiKeyAuth.test.ts`) — session auth, Bearer auth, invalid key rejection, length checks, lastUsedAt update

### Creator Social Accounts
- [x] GET/POST/DELETE `/api/creators/[id]/social-accounts` — multi-platform accounts per creator
- [x] Social Accounts tab on creator detail page — add/remove accounts, platform badges, stats
- [x] 14 integration tests (creatorSocialAccounts.test.ts)

### Analytics & KPI Dashboard
- [x] GET `/api/analytics` — org-level: total views/likes/comments/spend, avg CPM, avg engagement rate, monthly trend (6 months), creator leaderboard (top 10 by views), platform breakdown
- [x] `/analytics` page — 6 stat tiles, AreaChart monthly trend, creator leaderboard table, platform BarChart
- [x] Analytics added to sidebar (Financial section)
- [x] 4 integration tests (analytics.test.ts)

### Reports — PDF/Excel Export (Session 13)
- [x] `lib/reports/FinancialPDF.tsx` — react-pdf v4 Document: dark header, KPI boxes, monthly trend table, top campaigns table, branded footer
- [x] `POST /api/financial-reports/generate` — accepts `{ period, format: "pdf" | "xlsx" }`, streams binary download
- [x] Financial reports page updated with Export PDF and Export Excel buttons
- [x] 6 integration tests (financialReportGenerate.test.ts)

### MCP Server (Session 13)
- [x] `lib/mcp/tools.ts` — 5 tools: `list_campaigns`, `list_creators`, `get_org_kpis`, `search_creators`, `get_campaign`
- [x] `POST /api/mcp` — JSON-RPC handler implementing MCP protocol (initialize, tools/list, tools/call)
- [x] Auth via `authenticateRequest()` — works with session + Bearer API keys
- [x] `GET /api/mcp` — health check endpoint
- [x] 10 integration tests (mcpServer.test.ts)

### Audit Log API (Session 14)
- [x] `GET /api/audit-logs` — filterable (`action`, `entityType`, `q`, `from`, `to`), paginated
- [x] `GET /api/audit-logs/csv` — CSV streaming export, same filters, `Content-Disposition: attachment`
- [x] `AuditLogClient.tsx` — added "Export CSV" download link applying active filters
- [x] 9 integration tests (auditLog.test.ts)

### AI Integration (Session 14)
- [x] `POST /api/ai/briefing` — Claude Haiku org/campaign narrative summaries (requires `ANTHROPIC_API_KEY`)
- [x] `POST /api/ai/nl-query` — NL → typed Prisma query via intent classifier (no SQL), 5 intent types
- [x] 10 integration tests (aiBriefing.test.ts)

### Creator Reviews UI — Org Side (Session 15)
- [x] `ReviewsSection.tsx` — leave review modal (creator select, star picker, tag toggles, comment), review list with stars + tags
- [x] Campaign detail page — added "Reviews" tab, wired ReviewsSection
- [x] 7 integration tests (campaignReviews.test.ts)

### Portal Reviews Page (Session 15)
- [x] `GET /api/portal/reviews` — resolves CreatorUser → Creator via handle, returns reviews with org/campaign context
- [x] `/portal/reviews` page — reviews table + testimonials section + Write Testimonial modal
- [x] Portal nav — added "Reviews" link (Star icon)
- [x] 4 integration tests (portalReviews.test.ts)

### Metric Pipeline (Session 17)
- [x] Schema: Post + PostMetricSnapshot — added `savesCount`, `reachCount`, `platformMetrics`, `storyExpiresAt`, `downloadsCount`, `impressionsCount`, `syncSource`, `isFinalSnapshot`
- [x] GET `/api/campaigns/[id]/posts/[postId]` — post detail with creator + snapshots
- [x] PATCH `/api/campaigns/[id]/posts/[postId]` — extended for manual metric entry (creates PostMetricSnapshot with `syncSource: "manual"`)
- [x] GET `/api/campaigns/[id]/posts/[postId]/snapshots` — historical metric snapshots
- [x] POST `/api/campaigns/[id]/posts/[postId]/sync` — trigger platform sync for a post
- [x] "Update Metrics" modal in PostsTab (views/likes/comments/shares/saves)
- [x] Post detail page (`/campaigns/[id]/posts/[postId]`) — metric cards, Recharts AreaChart, snapshot history table, Sync Now button
- [x] `lib/platforms/fetchPostMetrics.ts` refactored — per-platform functions exported (`fetchYouTubeMetrics`, `fetchTikTokMetrics`, `fetchInstagramMetrics`)
- [x] GET `/api/cron/sync-posts` — hourly cron job with variable cadence (<24h=always, 1-7d=6h, 7-30d=24h)
- [x] `vercel.json` — cron config for hourly sync
- [x] 10 integration tests (postMetrics.test.ts)

### E2E Coverage (Session 15)
- [x] `e2e/portal-proposals.spec.ts` — proposals page + discover (chrome-portal)
- [x] `e2e/campaigns-proposals.spec.ts` — campaign proposals + reviews tab (chrome)
- [x] `e2e/portal-reviews.spec.ts` — portal reviews page + nav (chrome-portal)
- [x] `e2e/public-profile.spec.ts` — `/c/blessingjolie` public profile (chrome)

---

## Phase 5 — Production Infrastructure ✅ PARTIAL

- [x] Switch to Neon PostgreSQL (serverless)
- [x] Prisma schema updated to `provider = "postgresql"`
- [x] Prisma migrations set up (`prisma/migrations/`)
- [x] Database seeded on Neon
- [ ] Environment variables for production
- [ ] Deploy to Vercel: `vercel --prod`
- [ ] Custom domain setup

---

## Foundation Models (schema landed; some now wired into UI/API)

These Prisma models exist in the schema and are migrated. Some now have route/UI coverage, while others are still schema-only:

- **OrgPlanConfig** — per-org plan configuration / feature tier, now read by tenant config endpoint
- **UserInvite** — team invite system with dashboard UI + create/list/delete + accept route
- **ApiKey** — org-scoped API keys with settings UI + create/list/delete routes
- **CreatorSocialAccount** — multi-platform social accounts linked to a creator
- **CampaignType** — enum: BUDGET_BASED, VIEW_BASED, OPEN_COMMUNITY, PRIVATE_INVITE, now accepted by campaign APIs

## Cross-Cutting Improvements

- [x] Audit logging wired into major mutating routes (campaigns, creators, clients, payouts, activations, lists, invites, API keys, client plan assignment)
- [x] Tenant config now resolves plan/limits/features through `OrgPlanConfig` first, with `Organization.plan` fallback
- [x] RBAC helper now exposes `resolvePermissions()` for future override-aware checks
- [x] `GET /api/creators` now filters by `orgId`
- [x] `POST /api/lists/[id]/creators` now validates creator ownership within the org

---

## Known Bugs / Issues

| Bug | Status | Notes |
|-----|--------|-------|
| Port 3000 taken by Leegality | Known | Always use `PORT=3009 npm run dev` |
| Fan Pages 404 | Fixed | Shows "Coming soon" placeholder |
| Recipients 404 | Fixed | Shows placeholder |
| Page headers slightly clipped | Minor | Top padding issue, cosmetic only |
| `proxy.ts` named unusually | By design | It IS the Next.js middleware, don't rename |

---

## API Routes Reference

All routes require authentication (NextAuth session cookie).
All routes are multi-tenant (filter by orgId from session).

| Method | Route | Status | Notes |
|--------|-------|--------|-------|
| GET | `/api/campaigns` | ✅ Working | Returns org campaigns |
| POST | `/api/campaigns` | ✅ Working | Create campaign |
| GET | `/api/campaigns/[id]` | ✅ Working | Campaign detail |
| PATCH | `/api/campaigns/[id]` | ✅ Working | Update campaign |
| DELETE | `/api/campaigns/[id]` | ✅ Working | Soft delete |
| GET | `/api/creators` | ✅ Working | Returns org creators |
| POST | `/api/creators` | ✅ Working | Create creator |
| GET | `/api/creators/[id]` | ✅ Working | Creator detail with activations, posts, payouts |
| PATCH | `/api/creators/[id]` | ✅ Working | Update creator |
| GET | `/api/clients` | ✅ Working | Returns org clients |
| POST | `/api/clients` | ✅ Working | Create client |
| PATCH | `/api/clients/[id]` | ✅ Working | Update client |
| PUT | `/api/clients/[id]/features` | ✅ Working | Update plan + feature overrides |
| GET | `/api/payouts` | ✅ Working | Returns org payouts |
| POST | `/api/payouts` | ✅ Working | Create payout |
| PATCH | `/api/payouts/[id]` | ✅ Working | Update payout status (state machine) |
| PATCH | `/api/activations/[id]` | ✅ Working | Update activation status (state machine) |
| DELETE | `/api/activations/[id]` | ✅ Working | Soft delete activation |
| GET | `/api/lists/[id]` | ✅ Working | List detail with creator items |
| PATCH | `/api/lists/[id]` | ✅ Working | Update list name/description |
| DELETE | `/api/lists/[id]` | ✅ Working | Delete list and items |
| POST | `/api/lists/[id]/creators` | ✅ Working | Add creator(s) to list with org validation |
| GET | `/api/plans` | ✅ Working | Returns org plans (custom feature) |
| POST | `/api/plans` | ✅ Working | Create plan |
| PATCH | `/api/clients/[id]/plan` | ✅ Working | Assign plan to client |
| GET | `/api/invites` | ✅ Working | List org invites |
| POST | `/api/invites` | ✅ Working | Create invite |
| DELETE | `/api/invites/[id]` | ✅ Working | Cancel invite |
| POST | `/api/invites/accept` | ✅ Working | Accept invite and create user |
| GET | `/api/keys` | ✅ Working | List org API keys |
| POST | `/api/keys` | ✅ Working | Create API key |
| DELETE | `/api/keys/[id]` | ✅ Working | Revoke API key |
| GET | `/api/campaigns/[id]/view-ledger` | ✅ Working | View ledger entries grouped by creator |
| POST | `/api/campaigns/[id]/view-ledger` | ✅ Working | Record view snapshots for VIEW_BASED campaigns |
| GET | `/api/campaigns/[id]/payout-calculator` | ✅ Working | Per-creator payout summaries |
| POST | `/api/campaigns/[id]/fraud-scan` | ✅ Working | Run fraud detection on campaign posts |
| GET | `/api/campaigns/[id]/fraud-flags` | ✅ Working | List fraud flags (?resolved= filter) |
| PATCH | `/api/fraud-flags/[id]` | ✅ Working | Resolve/unresolve fraud flag |
| GET | `/api/trackers` | ✅ Working | List tracked TikTok sounds with latest snapshot |
| POST | `/api/trackers` | ✅ Working | Create tracked sound |
| GET | `/api/trackers/[id]` | ✅ Working | Sound detail with all snapshots |
| DELETE | `/api/trackers/[id]` | ✅ Working | Remove tracked sound |
| GET | `/api/payout-requests` | ✅ Working | Org-level aggregate payout requests |
| GET | `/api/calendar` | ✅ Working | Campaigns + activations by month |
| GET | `/api/analytics` | ✅ Working | Org-level KPI aggregates, leaderboard, trend |
| PATCH | `/api/portal/me` | ✅ Working | Update creator profile |
| GET | `/api/portal/payout-requests` | ✅ Working | Creator's payout requests |
| POST | `/api/portal/payout-requests` | ✅ Working | Creator creates payout request |

---

## Quick Commands

```bash
# Start dev server (MUST use port 3009)
PORT=3009 npm run dev

# Seed the database
npx prisma db seed

# Run migrations
npx prisma migrate dev

# Build check (run before committing)
npm run build

# Open Prisma Studio (visual DB browser)
npx prisma studio

# Run integration tests
npx jest --config jest.integration.config.js
```

---

## What To Work On Next

**Immediate priority (in order):**

1. **Campaign detail page** — make the tabs functional
   - Add creator to campaign (activation)
   - Show post deliverables

2. **Wire up foundation models** — build UI/API for:
   - UserInvite (team invite flow)
   - ApiKey (API key management page)
   - CreatorSocialAccount (multi-platform profiles on creator detail)

3. **Import real data** once ready
   - Build import scripts or use the UI forms
