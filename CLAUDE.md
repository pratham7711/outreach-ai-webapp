# CLAUDE.md — Legacy Agent Context File

> Shared contract lives in `/Users/pratham/Documents/Repositories/outreach-ai/AGENTS.md`.
> Use this file as project background, not as the source of workflow truth.

---

## What We're Building

A **pixel-perfect clone of [CreatorCore](https://app.creatorcore.co)** — an influencer marketing platform for managing campaigns, creators, clients, and payouts.

This is NOT a toy project. Goal is full 1:1 UI parity with the real app, plus feature extensions (custom Plans system, job scraper integration, etc.).

The real app account for visual reference: `sharmapratham290@gmail.com` at `https://app.creatorcore.co` (Pratham logs in manually — ask him if you need screenshots).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS + inline CSS vars |
| UI Components | `@pratham7711/ui` (custom design system) |
| Database | PostgreSQL (Neon). Legacy notes in this file may mention SQLite. Prefer current schema/config in code. |
| ORM | Prisma 7 with `@prisma/adapter-better-sqlite3` |
| Auth | NextAuth v5 (credentials + session) |
| Charts | Recharts |
| Icons | lucide-react |
| Runtime | Node 22, port **3009** (port 3000 is taken by another app) |

---

## Design System

These CSS variables are defined in `app/globals.css`. Use them **everywhere**. Never hardcode colors.

```css
--cc-bg: #EFF0F8          /* page background (light lavender) */
--cc-sidebar: #FFFFFF     /* sidebar background */
--cc-card: #FFFFFF        /* card / surface background */
--cc-border: #E4E6F0      /* all borders */
--cc-primary: #5B5BD6     /* primary purple — buttons, active state */
--cc-primary-hover: #4A4AC8
--cc-text: #1C2048        /* primary text — dark navy */
--cc-text-muted: #9097B4  /* secondary / placeholder text */
--cc-text-subtle: #C4C9E0 /* disabled, very muted */
```

**Dark colors that must NEVER appear:**
- `#111118`, `#0A0A0F`, `#0D0D14` → replace with `var(--cc-card)` or `white`
- `#2A2A3A`, `#1E1E2C` → replace with `var(--cc-border)`
- `#F0F0FF`, `#E0E0FF` → replace with `var(--cc-text)`
- `#8888AA`, `#555577` → replace with `var(--cc-text-muted)`
- `--color-primary` (old var name) → always replace with `--cc-primary`

---

## Key Component Patterns

### Page Header (every page must have this)
```tsx
<div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
  <div>
    <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Title</h1>
    <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Subtitle</p>
  </div>
  <button style={{ background: "var(--cc-primary)", color: "white", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
    Action
  </button>
</div>
```

### White Card
```tsx
<div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
```

### Button Styles (match real app exactly)
- **Primary action** (e.g. "New Campaign +"): Outlined — white bg, `1.5px solid #5B5BD6` border, `#5B5BD6` text
- **Secondary action** (e.g. "Folders"): Solid dark navy `#1E1B4B`, white text
- **Standard CTA** (e.g. "Add Creator"): Solid `var(--cc-primary)`, white text
- **Destructive**: `#DC2626` bg or border

### Status Tabs (campaigns page pattern)
```tsx
const STATUS_TABS = [
  { key: "ALL",         label: "All",      bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING",     label: "Pending",  bg: "#FEF3C7", color: "#D97706" },
  { key: "IN_PROGRESS", label: "Active",   bg: "#EEF2FF", color: "#4F46E5" },
  { key: "COMPLETE",    label: "Complete", bg: "#D1FAE5", color: "#059669" },
  { key: "CANCELLED",   label: "Canceled", bg: "#FEE2E2", color: "#DC2626" },
];
```

---

## Project Structure

```
webapp/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx          — Purple gradient bg, white card login
│   └── (dashboard)/
│       ├── layout.tsx              — Sidebar + TopBar wrapper
│       ├── campaigns/              — Campaign list + detail
│       ├── creators/               — Creator list + detail
│       ├── clients/                — Client list + detail
│       ├── payouts/                — Payout list
│       ├── activations/            — Activations list
│       ├── lists/                  — Creator lists
│       ├── discovery/              — Creator discovery
│       ├── dashboard/              — Overview dashboard
│       ├── plans/                  — Custom feature plan management (admin)
│       ├── fan-pages/              — Placeholder (coming soon)
│       └── [others]/               — calendar, trackers, requests, etc.
├── components/
│   ├── NewSidebar.tsx              — THE sidebar (white, grouped nav, purple active)
│   └── layout/
│       └── TopBar.tsx              — Light top bar with breadcrumb
├── lib/
│   ├── db.ts                       — Prisma client (better-sqlite3 adapter)
│   ├── auth.ts                     — NextAuth config
│   ├── auth.config.ts              — Auth middleware config
│   └── features.ts                 — Feature flag system for plans
├── prisma/
│   ├── schema.prisma               — Database schema (SQLite)
│   ├── seed.ts                     — Seeds admin@demo.com / admin123
│   └── dev.db                      — Local SQLite database
└── PROGRESS.md                     — ← READ THIS NEXT
```

---

## Database

**Local dev:** SQLite at `prisma/dev.db`
**Connection:** `better-sqlite3` adapter (NOT PrismaClient directly, NOT PrismaPg)

```ts
// lib/db.ts — how to get db client
import { db } from "@/lib/db";
```

**Key models:**
- `Organization` — multi-tenant root, every record belongs to an org
- `User` — auth, linked to org via `orgId`
- `Campaign` — core entity, has status, budget, client, team
- `Creator` — influencers, linked to org
- `Client` — brands/companies, linked to campaigns
- `Payout` — payments to creators
- `Plan` — custom feature tier (our addition, not in real app)
- `Activation` — creator-to-campaign assignment

**Everything is multi-tenant:** every query MUST include `where: { orgId }`.
Get orgId from: `const orgId = (session.user as any).orgId`

---

## Authentication

- **Middleware:** `proxy.ts` (acts as Next.js middleware — do NOT rename)
- **Auth config:** `lib/auth.ts` + `lib/auth.config.ts`
- **Session check pattern:**
```ts
const session = await auth();
if (!session?.user) redirect("/login");
const orgId = (session.user as any).orgId;
```

**Dev credentials:** `admin@demo.com` / `admin123`
**App URL:** `http://localhost:3009` (NOT 3000 — Leegality takes that port)

---

## Custom Plans System (our addition)

Built on top of the real app clone. Not in the real CreatorCore app.

- `lib/features.ts` — 10 typed feature flags
- `app/(dashboard)/plans/` — Admin UI to create/edit plans
- Plans stored on `Organization.plans` (JSON)
- Per-client overrides on `Client.featureOverrides`
- API routes: `/api/plans`, `/api/plans/[id]`, `/api/clients/[id]/plan`

---

## DO NOT:

- Use `--color-primary` (old CSS var) — always `--cc-primary`
- Hardcode dark colors (`#111118`, etc.)
- Query DB without `orgId` filter
- Touch `proxy.ts` (it's the auth middleware)
- Start `npm run dev` without `PORT=3009` (port 3000 is taken)
- Use `PrismaClient` directly — always import `db` from `@/lib/db`
- Push to production with `DATABASE_URL=file:./prisma/dev.db`

## ALWAYS:

- Read `PROGRESS.md` before starting work
- Read root `AGENTS.md` before starting work (cross-agent rules)
- Write descriptive git commit messages
- Run `npm run build` before committing (catch TS errors)
- Update `PROGRESS.md` after completing tasks
- Keep all pages on light theme (CSS vars above)
- Start dev server: `PORT=3009 npm run dev`
