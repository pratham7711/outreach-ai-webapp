# Outreach AI — Complete Documentation

> Everything you need to understand this project, from the big picture down to individual files.

---

## Table of Contents

1. [What Is This?](#1-what-is-this)
2. [How to Run It](#2-how-to-run-it)
3. [Project Architecture](#3-project-architecture)
4. [The Tech Stack (Explained Simply)](#4-the-tech-stack-explained-simply)
5. [How the App Is Organized](#5-how-the-app-is-organized)
6. [The Database](#6-the-database)
7. [Authentication (How Login Works)](#7-authentication-how-login-works)
8. [The Dashboard (Admin Side)](#8-the-dashboard-admin-side)
9. [The Creator Portal](#9-the-creator-portal)
10. [API Routes (The Backend)](#10-api-routes-the-backend)
11. [The Design System](#11-the-design-system)
12. [Feature Flags and Plans](#12-feature-flags-and-plans)
13. [Testing](#13-testing)
14. [Seed Data (Demo Content)](#14-seed-data-demo-content)
15. [File-by-File Reference](#15-file-by-file-reference)
16. [Known Issues](#16-known-issues)
17. [Glossary](#17-glossary)

---

## 1. What Is This?

Outreach AI is an **influencer campaign management platform**. Think of it as a tool that music labels, talent agencies, and brands use to:

- **Find creators** (influencers on TikTok, Instagram, YouTube, Twitter)
- **Run campaigns** (assign creators to promote songs, products, events)
- **Track performance** (views, likes, engagement on creator posts)
- **Pay creators** (manage payouts, invoices, payment methods)
- **Manage clients** (the brands or labels paying for campaigns)

It has two sides:

| Side | Who uses it | What they do |
|------|-------------|--------------|
| **Dashboard** (admin) | Agency staff, managers | Create campaigns, manage creators, process payouts |
| **Creator Portal** | Influencers/creators | Browse gigs, submit proposals, request payouts |

The app is **multi-tenant** — multiple organizations can use the same app, and each one only sees their own data. Think of it like Slack: every company has its own workspace.

---

## 2. How to Run It

### Prerequisites
- Node.js 22+
- A PostgreSQL database (we use [Neon](https://neon.tech) — free serverless Postgres)
- A `.env` file with `DATABASE_URL` and `NEXTAUTH_SECRET`

### Quick Start

```bash
# Install dependencies
npm install

# Set up the database (creates tables)
npx prisma migrate dev

# Fill the database with demo data
npx prisma db seed

# Start the app (MUST use port 3009)
PORT=3009 npm run dev
```

Then open http://localhost:3009 in your browser.

### Login Credentials

| Account | Email | Password | What it accesses |
|---------|-------|----------|------------------|
| Admin | admin@demo.com | admin123 | Full dashboard |
| Creator (Blessing Jolie) | creator@demo.com | creator123 | Creator portal |
| Creator (Alex Turner) | alex@demo.com | creator123 | Creator portal |

### Why Port 3009?

Port 3000 is used by another app on the dev machine. Always start with `PORT=3009`.

---

## 3. Project Architecture

Here is how the project is structured at the highest level:

```
outreach-ai/
  webapp/           <-- This app (Next.js)
    app/            <-- All pages and API routes
    components/     <-- Reusable UI components
    lib/            <-- Shared logic (auth, database, utilities)
    prisma/         <-- Database schema and seed data
    e2e/            <-- End-to-end browser tests
    __tests__/      <-- Unit and integration tests
    scripts/        <-- Automation scripts
    docs/           <-- Documentation (you are here)
    public/         <-- Static assets (images, icons)
  landing/          <-- Marketing website (separate app)
```

### How a Request Flows Through the App

```
Browser → Next.js Server → Auth Check → API Route → Prisma ORM → PostgreSQL Database
                                  ↓
                           Page Component → React Rendering → HTML to Browser
```

1. User visits a page (like `/campaigns`)
2. Next.js checks authentication (are they logged in?)
3. If authenticated, the page component runs on the server
4. The component fetches data via Prisma (our database tool)
5. React renders the HTML and sends it to the browser
6. Client-side JavaScript takes over for interactivity (search, filters, modals)

---

## 4. The Tech Stack (Explained Simply)

| Technology | What it does | Why we use it |
|-----------|--------------|---------------|
| **Next.js 16** | Web framework — handles routing, server rendering, API routes | Industry standard for React apps, great for SEO and performance |
| **React 19** | UI library — builds the interface from reusable components | The most popular way to build web UIs |
| **TypeScript** | JavaScript with types — catches bugs before they run | Prevents entire categories of bugs |
| **Tailwind CSS 4** | Styling — utility classes instead of writing CSS files | Fast to build, consistent design |
| **PostgreSQL** | Database — stores all the data (campaigns, creators, etc.) | Rock-solid, handles complex queries |
| **Neon** | Serverless Postgres hosting | Free tier, scales automatically, no server management |
| **Prisma 7** | ORM — talks to the database using TypeScript instead of SQL | Type-safe queries, auto-generated from schema |
| **NextAuth v5** | Authentication — handles login, sessions, JWT tokens | Standard auth for Next.js, supports many providers |
| **Playwright** | Browser testing — automates Chrome to test the app | Tests the app exactly like a real user would |
| **Jest** | Unit/integration testing — tests individual functions | Fast, reliable testing for backend logic |
| **Recharts** | Charts — renders graphs and visualizations | React-native charting library |
| **Framer Motion** | Animations — smooth transitions and micro-interactions | Makes the UI feel polished |
| **Lucide React** | Icons — consistent icon set across the app | Clean, lightweight SVG icons |

---

## 5. How the App Is Organized

### Page Groups

Next.js uses **file-based routing**. Every file in `app/` becomes a URL:

```
app/
  (auth)/                    <-- Auth pages (login, signup, forgot-password)
    login/page.tsx           → /login
    signup/page.tsx          → /signup

  (dashboard)/               <-- Main admin dashboard (requires login)
    layout.tsx               → Sidebar + TopBar wrapper for all dashboard pages
    dashboard/page.tsx       → /dashboard
    campaigns/page.tsx       → /campaigns
    campaigns/[id]/page.tsx  → /campaigns/camp-1 (dynamic route)
    creators/page.tsx        → /creators
    creators/[id]/page.tsx   → /creators/creator-1
    clients/page.tsx         → /clients
    payouts/page.tsx         → /payouts
    activations/page.tsx     → /activations
    lists/page.tsx           → /lists
    discovery/page.tsx       → /discovery
    calendar/page.tsx        → /calendar
    deadlines/page.tsx       → /deadlines
    connections/page.tsx     → /connections
    financial-reports/page.tsx → /financial-reports
    settings/page.tsx        → /settings
    settings/profile/page.tsx → /settings/profile
    settings/team/page.tsx   → /settings/team
    settings/api-keys/page.tsx → /settings/api-keys
    settings/billing/page.tsx → /settings/billing
    audit-log/page.tsx       → /audit-log
    plans/page.tsx           → /plans
    admin/page.tsx           → /admin

  (portal)/                  <-- Creator-facing portal (separate auth)
    portal/login/page.tsx    → /portal/login
    portal/dashboard/page.tsx → /portal/dashboard
    portal/discover/page.tsx  → /portal/discover
    portal/proposals/page.tsx → /portal/proposals
    portal/payout-requests/page.tsx → /portal/payout-requests
    portal/settings/page.tsx  → /portal/settings

  api/                       <-- Backend API routes
    campaigns/route.ts       → GET/POST /api/campaigns
    campaigns/[id]/route.ts  → GET/PATCH/DELETE /api/campaigns/:id
    ... (80+ routes total)
```

### The Parentheses `(auth)`, `(dashboard)`, `(portal)`

These are **route groups** in Next.js. They don't create URL segments — they just let us group pages that share a layout. For example:
- Everything in `(dashboard)/` gets the sidebar + topbar layout
- Everything in `(portal)/` gets the portal navigation bar
- Everything in `(auth)/` gets a centered card layout with purple gradient background

### Server Components vs Client Components

Next.js has two types of components:

- **Server Components** (default): Run on the server, can directly access the database, don't ship JavaScript to the browser. Most of our pages are server components.
- **Client Components** (marked with `"use client"`): Run in the browser, can use React hooks (useState, useEffect), handle user interactions. Used for interactive features like search, filters, modals, and forms.

---

## 6. The Database

### How We Talk to the Database

We use **Prisma** — it lets us write TypeScript instead of SQL:

```typescript
// Instead of: SELECT * FROM campaigns WHERE orgId = '...' AND status = 'IN_PROGRESS'
const campaigns = await db.campaign.findMany({
  where: { orgId, status: 'IN_PROGRESS' },
  include: { client: true },
});
```

The database client is imported from `lib/db.ts`:
```typescript
import { db } from "@/lib/db";
```

### Key Rule: Multi-Tenancy

**Every database query MUST include `orgId`**. This ensures organizations can only see their own data:

```typescript
// CORRECT
const creators = await db.creator.findMany({ where: { orgId } });

// WRONG — would leak data across organizations
const creators = await db.creator.findMany();
```

### Core Data Models

Here is a simplified view of what is stored in the database:

```
Organization (the tenant — "Demo Agency")
  ├── Users (team members — admin@demo.com)
  ├── Clients (brands — "Sony Music", "Warner Music")
  ├── Creators (influencers — "Blessing Jolie", "Alex Turner")
  ├── Campaigns (projects — "LEAK IT (BTS)", "CRUEL WORLD")
  │     ├── Activations (creator assignments to campaigns)
  │     ├── Posts (social media deliverables with metrics)
  │     ├── Deposits (payment tracking)
  │     ├── Invites (creator invitations)
  │     ├── Proposals (creator applications)
  │     └── Financials (budget tracking)
  ├── Payouts (payments to creators)
  ├── Lists (curated creator collections)
  ├── Plans (feature tiers — Starter, Pro, Enterprise)
  └── AuditLogs (activity tracking)
```

### Campaign Lifecycle

A campaign goes through these statuses:

```
DRAFT → PENDING → IN_PROGRESS → COMPLETE
                               → CANCELLED
```

### Activation Lifecycle

When a creator is assigned to a campaign, the activation moves through:

```
AWAITING_DRAFT → DRAFT_SUBMITTED → AWAITING_APPROVAL → APPROVED → POSTING → POSTED → COMPLETE
                                                                                    → DECLINED
```

### Campaign Types

| Type | How creators get paid |
|------|----------------------|
| BUDGET_BASED | Fixed budget split among creators |
| VIEW_BASED | Paid per view (CPM rate) |
| OPEN_COMMUNITY | Open to any creator |
| PRIVATE_INVITE | Invite-only |

---

## 7. Authentication (How Login Works)

### Dashboard Auth (Admin/Team)

Uses **NextAuth v5** with JWT tokens:

1. User submits email + password at `/login`
2. Server verifies password against bcrypt hash in the database
3. Server creates a JWT token containing: `{ userId, email, orgId, role }`
4. Token is stored as an HTTP-only cookie (`authjs.session-token`)
5. Every subsequent request includes this cookie automatically
6. Server decodes the token to identify the user and their organization

**Roles**: OWNER, ADMIN, MANAGER, MEMBER, VIEWER (each with different permissions)

### Portal Auth (Creator)

Uses a simpler **session token** system:

1. Creator submits email + password at `/portal/login`
2. Server verifies credentials against the `CreatorUser` table
3. Server generates a random 96-character hex token
4. Token is stored in the `CreatorSession` database table
5. Token is set as an HTTP-only cookie (`creator_portal_token`)
6. Every request checks the token against the database

This is separate from dashboard auth — creators and team members use different login systems.

### How Auth Is Checked in Code

**Dashboard pages:**
```typescript
const session = await auth();
if (!session?.user) redirect("/login");
const orgId = (session.user as any).orgId;
```

**API routes:**
```typescript
const session = await auth();
if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
const orgId = (session.user as any).orgId;
```

**Portal pages:**
```typescript
const session = await getCreatorSession();
if (!session) redirect("/portal/login");
```

---

## 8. The Dashboard (Admin Side)

### Sidebar Navigation

The sidebar is organized into 5 sections:

| Section | Pages | Purpose |
|---------|-------|---------|
| **Campaigns & Reporting** | Campaigns, Activations, Calendar, Deadlines, Clients, Fan Pages, Trackers | Managing campaigns and deliverables |
| **Creators & Pitching** | Discovery, Creators, Lists | Finding and organizing creators |
| **Financial** | Payouts, Requests, Financials, Recipients | Money management |
| **Settings** | Settings, Connections, Audit Log, Team, API Keys, Billing | Configuration |
| **Admin** | Feature Access, Plans | Admin-only controls |

### Key Pages Explained

**Dashboard** (`/dashboard`)
- Overview with stat cards: Active Campaigns, Active Creators, Pending Payouts, Growth
- Recent campaigns table
- Spend chart over time (6-month trend)
- Date range controls (7D, 30D, 90D, 6M, 1Y)

**Campaigns** (`/campaigns`)
- List of all campaigns with search and filters
- Status tabs: All, Pending, Active, Complete, Cancelled
- Each campaign shows: title, status badge, budget, client name
- "New Campaign" button opens a creation wizard

**Campaign Detail** (`/campaigns/[id]`)
- 6 tabs: Overview, Posts, Creators, Analytics, Financials, Edit
- Overview: stat cards (views, engagement, creators, budget used), creative brief, notes
- Posts: table of social media posts with metrics
- Creators: assigned creators with activation status
- Analytics: charts (platform breakdown, creator comparison)
- Financials: budget pie chart, payout breakdown

**Creators** (`/creators`)
- Grid or table view toggle
- Platform filter: All, Instagram, YouTube, TikTok, Twitter
- Search by name or handle
- Each card shows: avatar, name, handle, followers, engagement rate

**Clients** (`/clients`)
- Company/brand list
- Each client shows campaigns count and plan tier

**Payouts** (`/payouts`)
- Payment tracking table
- Status: Pending, Processing, Success, Failed
- Filter by creator or campaign

**Discovery** (`/discovery`)
- Search for new creators by name, handle, platform, niche
- Advanced filters: follower range, rate range
- Sort by: Most Followers, Highest Engagement, Name A-Z
- Feature-gated: requires "Creator Discovery" plan feature

**Calendar** (`/calendar`)
- Month view with campaign events and deliverable due dates
- Color-coded by campaign status
- Click a day to see details

**Settings** (`/settings`)
- Hub page with links to: Profile, Team, API Keys, Billing
- Profile: org name, branding colors, logo, bank details
- Team: invite members, manage roles
- API Keys: create/revoke programmatic access
- Billing: plan management

---

## 9. The Creator Portal

A separate interface for creators (influencers) to interact with agencies.

### Portal Pages

**Login** (`/portal/login`)
- Email + password form
- Toggle between Sign In and Register modes
- Creates a `CreatorUser` account (separate from team `User`)

**Dashboard** (`/portal/dashboard`)
- Welcome message with creator name and avatar
- Stat cards: Lifetime Earnings, Total Proposals, Accepted, Rating
- Recent proposals table

**Discover** (`/portal/discover`)
- Browse available campaigns
- Filter by campaign type: Budget, View-Based, Community, Private
- Search, sort, budget range filters
- "Submit Proposal" button on each campaign card

**Proposals** (`/portal/proposals`)
- List of submitted proposals with status (Pending, Accepted, Rejected, Withdrawn)

**Payouts** (`/portal/payout-requests`)
- Request payouts for completed work
- Track payout request status

**Settings** (`/portal/settings`)
- Edit profile, niches, bank details

---

## 10. API Routes (The Backend)

Every feature in the app is powered by API routes. These are server-side functions that handle data operations.

### Pattern

All API routes follow the same pattern:

```typescript
// 1. Check authentication
const session = await auth();
if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// 2. Get the organization ID from the session
const orgId = (session.user as any).orgId;

// 3. Do the work (always filtering by orgId for multi-tenancy)
const data = await db.campaign.findMany({ where: { orgId } });

// 4. Return the response
return NextResponse.json(data);
```

### API Groups

| Group | Routes | Purpose |
|-------|--------|---------|
| `/api/campaigns/*` | 12 routes | Campaign CRUD, posts, deposits, invites, proposals, negotiations |
| `/api/creators/*` | 8 routes | Creator CRUD, social accounts |
| `/api/clients/*` | 6 routes | Client CRUD, plan assignment |
| `/api/payouts/*` | 6 routes | Payout CRUD, bulk operations |
| `/api/activations/*` | 3 routes | Activation management |
| `/api/lists/*` | 5 routes | Creator list management |
| `/api/portal/*` | 10 routes | Creator portal (separate auth) |
| `/api/campaigns/[id]/view-ledger` | 5 routes | View-based campaign tracking |
| `/api/keys/*` | 3 routes | API key management |
| `/api/plans/*` | 4 routes | Feature plan CRUD |
| `/api/calendar` | 1 route | Calendar events |
| `/api/discovery` | 1 route | Creator search |
| `/api/connections` | 1 route | Platform connections |
| `/api/financial-reports` | 1 route | Financial dashboard data |
| `/api/audit-logs` | 1 route | Activity log |

### Auth Check Summary

| Endpoint group | Auth required | Who can access |
|----------------|--------------|----------------|
| `/api/*` (most) | Dashboard JWT | Team members with valid session |
| `/api/portal/*` | Portal token | Creators with valid portal session |
| `/api/auth/*` | None | Public (login/register) |
| `/api/portal/auth/*` | None | Public (portal login/register) |

---

## 11. The Design System

### CSS Variables

All colors are defined as CSS custom properties in `app/globals.css`. **Never hardcode colors** — always use these variables:

| Variable | Value | Usage |
|----------|-------|-------|
| `--cc-bg` | `#EFF0F8` | Page background (light lavender) |
| `--cc-sidebar` | `#FFFFFF` | Sidebar background |
| `--cc-card` | `#FFFFFF` | Card/surface background |
| `--cc-border` | `#E4E6F0` | All borders |
| `--cc-primary` | `#5B5BD6` | Primary purple (buttons, active states) |
| `--cc-primary-hover` | `#4A4AC8` | Primary hover state |
| `--cc-text` | `#1C2048` | Primary text (dark navy) |
| `--cc-text-muted` | `#9097B4` | Secondary/placeholder text |
| `--cc-text-subtle` | `#C4C9E0` | Disabled/very muted text |

### Component Library

We use `@pratham7711/ui` — a custom component library. Key components:

| Component | What it does |
|-----------|-------------|
| `Button` | Clickable button (variants: primary, ghost, secondary, destructive) |
| `Card` | White container with border and rounded corners |
| `Badge` | Small colored pill (for status indicators) |
| `StatCard` | Number + label card (for dashboards) |
| `Input` | Text input field |
| `Avatar` | User/creator profile picture |
| `EmptyState` | Placeholder when no data exists |
| `Modal` | Overlay dialog for forms and confirmations |
| `Tag` | Small label chip (for niches, categories) |
| `Tooltip` | Hover information popup |
| `Skeleton` | Loading placeholder animation |

### Status Colors

| Status | Background | Text Color |
|--------|-----------|------------|
| Pending | `#FEF3C7` | `#D97706` (amber) |
| Active/In Progress | `#EEF2FF` | `#4F46E5` (indigo) |
| Complete | `#D1FAE5` | `#059669` (green) |
| Cancelled/Failed | `#FEE2E2` | `#DC2626` (red) |
| Draft/Neutral | `#F3F4F6` | `#374151` (gray) |

---

## 12. Feature Flags and Plans

### How It Works

Organizations subscribe to plans (Starter, Pro, Enterprise). Each plan enables different features:

| Feature | Starter | Pro | Enterprise |
|---------|---------|-----|------------|
| Analytics Dashboard | Yes | Yes | Yes |
| Campaign Budget Tools | Yes | Yes | Yes |
| Bulk Export | No | Yes | Yes |
| API Access | No | Yes | Yes |
| Advanced Reports | No | Yes | Yes |
| Creator Discovery | No | Yes | Yes |
| Multi-Currency | No | Yes | Yes |
| Media Kits | No | Yes | Yes |
| Custom Branding | No | No | Yes |
| Audit Log | No | No | Yes |

### In Code

```typescript
import { FEATURES } from "@/lib/features";

// Check if a client has access to a feature
const hasDiscovery = clientHasFeature(plan, overrides, "creator_discovery");

// API routes return 403 if the feature is disabled
if (!hasFeature) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

### Client Overrides

Individual clients can have feature overrides that differ from their plan. For example, Atlantic Records is on the Pro plan but has API Access and Media Kits disabled via overrides.

---

## 13. Testing

The app has three layers of tests, each catching different types of bugs:

### Layer 1: Unit Tests (Jest)

**What they test:** Individual functions and React components in isolation.
**Where:** `__tests__/unit/`
**Count:** 14 test files

Examples:
- Does the sidebar render all navigation links?
- Does the feature gate component hide content correctly?
- Does the RBAC (role-based access control) logic return correct permissions?

```bash
npm run test:unit
```

### Layer 2: Integration Tests (Jest)

**What they test:** API route handlers with mocked database and auth.
**Where:** `__tests__/integration/`
**Count:** 51 test files

Examples:
- Does `GET /api/campaigns` return campaigns for the authenticated org?
- Does `POST /api/campaigns` reject requests without auth (401)?
- Does `GET /api/campaigns` with wrong orgId return empty results (403)?

```bash
npm run test:integration
```

### Layer 3: End-to-End Tests (Playwright)

**What they test:** The full app in a real browser — exactly as a user would experience it.
**Where:** `e2e/`
**Count:** 22 test files, 60 tests passing

These open Chrome, navigate to pages, click buttons, fill forms, and verify that the correct content appears. They test the entire stack: frontend + backend + database.

```bash
npm run test:e2e         # Run in terminal
npm run test:e2e:ui      # Run with Playwright's visual UI
```

### E2E Test Coverage Map

| Page/Feature | Test File | What's Tested |
|--------------|-----------|---------------|
| Login page | `auth.spec.ts` | Form renders, error on bad credentials, redirect for unauthenticated |
| Dashboard | `dashboard.spec.ts` | Heading, stat cards, recent campaigns, sidebar links |
| Campaigns list | `campaigns.spec.ts` | Heading, lists 5 campaigns, status tabs, search filtering |
| Campaign detail | `campaigns-detail.spec.ts` | Title, status badge, tabs, budget display |
| Creators list | `creators.spec.ts` | Heading, lists creators, platform badges, nav to detail |
| Creator detail | `creators-detail.spec.ts` | Name/handle, profile tabs, follower stats |
| Clients | `clients.spec.ts` | Heading, lists 5 seed clients |
| Payouts | `payouts.spec.ts` | Heading, payout data, status indicators |
| Activations | `activations.spec.ts` | Heading, seed data, status badges |
| Lists | `lists.spec.ts` | Heading, empty state |
| Discovery | `discovery.spec.ts` | Heading, platform filters, handles disabled state |
| Settings | `settings.spec.ts` | Hub page, profile/team/api-keys subpages |
| Calendar | `calendar.spec.ts` | Page loads with calendar content |
| Connections | `connections.spec.ts` | Page loads with platform sections |
| Deadlines | `deadlines.spec.ts` | Page loads with stat cards |
| Financial Reports | `financial-reports.spec.ts` | Page loads with period tabs |
| Navigation | `navigation.spec.ts` | All 13 admin pages load, sidebar links present |
| Audit Log | `audit-log.spec.ts` | Page loads with controls |
| Portal Login | `portal-auth.spec.ts` | Form renders, error on bad credentials |
| Portal Dashboard | `portal-dashboard.spec.ts` | Welcome message, stat cards |
| Portal Discover | `portal-discover.spec.ts` | Heading, search/filter controls |

### How Auth Works in Tests

**Dashboard tests** use JWT injection — the auth setup generates a valid NextAuth JWT token directly (no login form needed) and saves it as a browser cookie.

**Portal tests** use API login — the portal setup calls `POST /api/portal/auth/login` to get a real session cookie from the server.

This is configured in `playwright.config.ts` with separate "projects":
- `setup` — generates admin JWT cookie
- `portal-setup` — logs in via API for portal cookie
- `chrome` — runs admin tests with saved session
- `chrome-noauth` — runs auth tests without any session
- `chrome-portal` — runs portal tests with portal session

### Running All Tests

```bash
# Run everything (unit + integration + E2E)
npm test

# Run only E2E
npm test -- --e2e-only

# Run only unit tests
npm test -- --unit-only

# Run only integration tests
npm test -- --integration-only

# Run unit tests with code coverage
npm run test:coverage
```

The master test runner (`scripts/run-tests.js`) orchestrates all three test suites and prints a summary:

```
========================================
         Test Results Summary
========================================
  unit            PASS
  integration     PASS
  e2e             PASS
========================================
```

---

## 14. Seed Data (Demo Content)

Running `npx prisma db seed` creates a full demo environment:

### Organization
- **Name:** Demo Agency
- **Subdomain:** demo-agency
- **Plan:** Pro
- **Features enabled:** Sound Tracker, Reports, CSV Export

### Users (Team)
| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | admin123 | OWNER |

### Clients (5)
| Name | Plan |
|------|------|
| Sony Music | Pro |
| Universal Records | Starter |
| Warner Music | Enterprise |
| Atlantic Records | Pro (with overrides) |
| Interscope Records | None |

### Creators (10)
| Name | Handle | Platform | Followers | Rate |
|------|--------|----------|-----------|------|
| Blessing Jolie | @blessingjolie | Instagram | 2.4M | $5,000 |
| Alex Turner | @alexturner | TikTok | 890K | $2,000 |
| Maria Santos | @mariasantos | YouTube | 1.2M | $3,500 |
| James Kim | @jameskim | Instagram | 450K | $1,500 |
| Priya Patel | @priyapatel | TikTok | 3.1M | $8,000 |
| Liam Brooks | @liambrooks | YouTube | 780K | $2,500 |
| Nina Okafor | @ninaokafor | Instagram | 1.6M | $4,500 |
| Tomas Rivera | @tomasrivera | TikTok | 520K | $1,800 |
| Emma Chen | @emmachen | YouTube | 2.1M | $6,000 |
| David Osei | @davidosei | Twitter | 340K | $1,200 |

### Campaigns (5)
| Title | Status | Budget | Client |
|-------|--------|--------|--------|
| LEAK IT (BTS) | IN_PROGRESS | $25,000 | Sony Music |
| FUJI KAZE (2ND PHASE) | IN_PROGRESS | $40,000 | Universal Records |
| Blessing Jolie | IN_PROGRESS | $15,000 | Sony Music |
| CRUEL WORLD | COMPLETE | $30,000 | Warner Music |
| American Girls | PENDING | — | Universal Records |

### Activations (4)
| Creator | Campaign | Status |
|---------|----------|--------|
| Blessing Jolie | LEAK IT (BTS) | APPROVED |
| Alex Turner | LEAK IT (BTS) | APPROVED |
| Priya Patel | FUJI KAZE (2ND PHASE) | APPROVED |
| Blessing Jolie | Blessing Jolie | COMPLETE |

### Payouts (3)
| Creator | Amount | Status |
|---------|--------|--------|
| Blessing Jolie | $5,000 | SUCCESS |
| Alex Turner | $2,000 | PENDING |
| Priya Patel | $8,000 | PENDING |

### Portal Users (2)
| Email | Password | Creator Profile |
|-------|----------|----------------|
| creator@demo.com | creator123 | Blessing Jolie |
| alex@demo.com | creator123 | Alex Turner |

---

## 15. File-by-File Reference

### Root Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies and scripts |
| `next.config.ts` | Next.js configuration |
| `tailwind.config.ts` | Tailwind CSS configuration |
| `tsconfig.json` | TypeScript configuration |
| `playwright.config.ts` | Playwright E2E test configuration |
| `jest.config.js` | Jest unit test configuration |
| `jest.integration.config.js` | Jest integration test configuration |
| `proxy.ts` | Auth middleware (DO NOT RENAME) |
| `.env` | Environment variables (DATABASE_URL, NEXTAUTH_SECRET) |

### `lib/` — Shared Logic

| File | Purpose |
|------|---------|
| `lib/db.ts` | Prisma database client (singleton) |
| `lib/auth.ts` | NextAuth configuration and exports |
| `lib/auth.config.ts` | Auth middleware configuration |
| `lib/creator-auth.ts` | Portal authentication (session tokens) |
| `lib/features.ts` | Feature flag definitions and checks |

### `prisma/` — Database

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Database schema (all tables and relationships) |
| `prisma/seed.ts` | Seed script (creates demo data) |
| `prisma/migrations/` | Database migration files |

### `components/` — Reusable UI

| File | Purpose |
|------|---------|
| `components/NewSidebar.tsx` | Main sidebar navigation |
| `components/layout/TopBar.tsx` | Top navigation bar with breadcrumbs |
| `components/layout/DashboardContent.tsx` | Main content area wrapper |

### `e2e/` — Browser Tests

| File | Purpose |
|------|---------|
| `e2e/helpers.ts` | Shared test utilities (waitForMain, expectHeading, searchFor) |
| `e2e/fixtures/auth.setup.ts` | Admin JWT token generation |
| `e2e/fixtures/portal-auth.setup.ts` | Portal session creation |
| `e2e/*.spec.ts` | Individual test files (22 total) |

### `scripts/` — Automation

| File | Purpose |
|------|---------|
| `scripts/run-tests.js` | Master test runner (unit + integration + E2E) |

---

## 16. Known Issues

| Issue | Severity | Details |
|-------|----------|---------|
| Client detail page error | Medium | `/clients/[id]` throws a server error. The list page works fine. |
| Discovery returns 403 | Low | The `/api/discovery` endpoint requires the `creator_discovery` feature flag, which isn't enabled on the demo org's plan by default. The UI shows "Creator Discovery is disabled" correctly. |
| Port 3000 unavailable | Info | Must use `PORT=3009` to start the dev server. |
| CSRF login test skipped | Low | E2E test for actual login form submission is skipped because NextAuth requires CSRF token handling that Playwright can't easily replicate. Auth is tested via JWT injection instead. |

---

## 17. Glossary

| Term | Meaning |
|------|---------|
| **Activation** | A creator assigned to a specific campaign. Tracks their status from draft to completion. |
| **Campaign** | A marketing project — e.g., promoting a new song or product through creator content. |
| **Client** | The brand or company paying for a campaign (e.g., Sony Music). |
| **Creator** | An influencer on social media who creates content for campaigns. |
| **CreatorUser** | A creator's login account for the portal (separate from team User accounts). |
| **CPM** | Cost Per Mille — price per 1,000 views. Used in view-based campaigns. |
| **Feature Flag** | A toggle that enables/disables functionality based on the organization's plan. |
| **JWT** | JSON Web Token — a compact, signed token used for authentication. |
| **Multi-tenant** | Architecture where one app serves multiple organizations, each seeing only their own data. |
| **ORM** | Object-Relational Mapping — Prisma translates TypeScript into SQL queries. |
| **orgId** | Organization ID — included in every database query to ensure data isolation. |
| **Payout** | A payment made to a creator for their work on a campaign. |
| **Plan** | A feature tier (Starter, Pro, Enterprise) that determines what an organization can access. |
| **Portal** | The creator-facing side of the app where influencers browse gigs and manage their work. |
| **Proposal** | A creator's application to work on a campaign (submitted through the portal). |
| **Seed Data** | Pre-populated demo data created by `prisma db seed`. |
| **Server Component** | A React component that runs on the server (can access database directly). |
| **Client Component** | A React component that runs in the browser (handles interactivity). |
| **View Ledger** | A record of view counts over time for view-based campaigns. |
