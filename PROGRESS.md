# PROGRESS.md — Implementation Tracker

> **Agent instructions:** Read this file to understand what's done and what to work on next.
> When you complete a task, update this file — move items from ⏳ to ✅, add notes.

---

## Current Status

**Phase:** Phase 3 — Real Data Integration
**Last updated:** 2026-03-20
**App URL:** http://localhost:3009
**Login:** admin@demo.com / admin123
**DB:** prisma/dev.db (SQLite — empty, no real data yet)

---

## Phase 1 — Foundation ✅ COMPLETE

- [x] Next.js 16 app scaffold (App Router, TypeScript, Tailwind)
- [x] Prisma 7 schema — full multi-tenant data model
- [x] NextAuth v5 credentials login
- [x] Multi-tenant architecture (orgId on all models)
- [x] SQLite local dev database (`prisma/dev.db`)
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

## Phase 3 — Real Data Integration ⏳ IN PROGRESS

### Database Setup
- [ ] **Choose production DB** — options:
  - Supabase (managed PostgreSQL, free tier, was paused before)
  - Railway PostgreSQL (~$5/mo)
  - Local PostgreSQL (`brew install postgresql`)
  - Neon (serverless PostgreSQL, generous free tier) ← **recommended**
- [ ] Update `.env` `DATABASE_URL` to production DB
- [ ] Run `npx prisma db push` on production DB
- [ ] Verify build passes with production DB

### Organization Setup
- [ ] **Create real organization** — replace "Demo Agency" in seed or via DB
  - Fields: name, subdomain, logoUrl, primaryColor
  - Currently seeded: `Demo Agency` (subdomain: `demo-agency`)
- [ ] **Create real user accounts** for team members
  - Current: only `admin@demo.com` / `admin123`
  - Need: add Pratham's real email, team members

### Real Data Import
- [ ] **Campaigns** — import from real app or create fresh
  - Build: `scripts/import-campaigns.ts` OR
  - Use: "New Campaign" form (UI exists but form not wired yet)
  - Fields: title, status, budget, currency, clientId, imageUrl
- [ ] **Creators** — import influencer roster
  - Build: `scripts/import-creators.ts` OR
  - Use: "Add Creator" form (UI exists but form not wired yet)
  - Fields: name, handle, platform, followerCount, engagementRate, rate, avatarUrl
- [ ] **Clients** — import client/brand list
  - Build: `scripts/import-clients.ts` OR
  - Use: "Add Client" form (needs building)
  - Fields: name, logoUrl, contactInfo
- [ ] **Payouts** — import payment records (if any)

### Create/Edit Forms (currently show empty state, no way to add data via UI)
- [ ] **New Campaign form** — modal or page, wires to `POST /api/campaigns`
- [ ] **Add Creator form** — modal or page, wires to `POST /api/creators`
- [ ] **Add Client form** — modal or page, wires to `POST /api/clients`
- [ ] **Add Payout form** — modal or page, wires to `POST /api/payouts`

### Authentication (production-ready)
- [ ] **Add real user accounts** via seed or admin UI
- [ ] **Optional: Google OAuth** — add to NextAuth config for easier login
  - Needs: Google Cloud Console OAuth client
  - Config: add to `lib/auth.ts` providers array
- [ ] **Password reset flow** — currently not implemented

---

## Phase 4 — Feature Completion ⏳ TODO

### Campaign Detail Page
- [ ] Wire up Creators tab — show assigned creators (activations)
- [ ] Wire up Posts tab — show campaign deliverables
- [ ] Wire up Budget tab — show budget breakdown
- [ ] Add creator to campaign (activation creation)
- [ ] Campaign edit form

### Creator Detail Page  
- [ ] Creator stats display (followers, engagement rate)
- [ ] Campaign history (which campaigns they've been in)
- [ ] Edit creator form

### Client Detail Page
- [ ] Edit client form ← partially done
- [ ] Campaign history for client

### Payouts
- [ ] Add payout form
- [ ] Payout status management (Pending → Paid flow)
- [ ] Bulk payout marking

### Activations
- [ ] List of all creator-campaign assignments
- [ ] Assignment management

### Discovery
- [ ] Creator search/filter system
- [ ] Add to list functionality

### Lists
- [ ] Create new list
- [ ] Add creators to list

### Calendar
- [ ] Campaign timeline view
- [ ] Deadline tracking

### Connections
- [ ] Platform OAuth connections (Instagram, TikTok, YouTube)
- [ ] API key management

---

## Phase 5 — Production Deploy ⏳ TODO

- [ ] Switch to PostgreSQL (Neon or Railway)
- [ ] Environment variables for production
- [ ] Deploy to Vercel: `vercel --prod`
- [ ] Custom domain setup
- [ ] Production seed with real org data

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
| GET | `/api/clients` | ✅ Working | Returns org clients |
| POST | `/api/clients` | ✅ Working | Create client |
| GET | `/api/payouts` | ✅ Working | Returns org payouts |
| POST | `/api/payouts` | ✅ Working | Create payout |
| GET | `/api/plans` | ✅ Working | Returns org plans (custom feature) |
| POST | `/api/plans` | ✅ Working | Create plan |
| PATCH | `/api/clients/[id]/plan` | ✅ Working | Assign plan to client |

---

## Quick Commands

```bash
# Start dev server (MUST use port 3009)
PORT=3009 npm run dev

# Reset database (wipes all data, re-creates schema)
rm prisma/dev.db && npx prisma db push && npx tsx prisma/seed.ts

# Build check (run before committing)
npm run build

# Open Prisma Studio (visual DB browser)
DATABASE_URL="file:./prisma/dev.db" npx prisma studio
```

---

## What To Work On Next

**Immediate priority (in order):**

1. **Wire up create forms** so Pratham can add campaigns/creators/clients via the UI
   - Start with: Campaign create modal (`components/CampaignModal.tsx`)
   - Then: Creator add form
   - Then: Client add form

2. **Campaign detail page** — make the tabs functional
   - Add creator to campaign (activation)
   - Show post deliverables

3. **Choose + configure production database**
   - Recommended: Neon (free, serverless PostgreSQL)
   - Steps: sign up → copy DATABASE_URL → `prisma db push` → seed

4. **Import real data** once DB is set up
   - Build import scripts or use the UI forms once they exist
