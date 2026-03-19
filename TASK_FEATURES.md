# Task: CreatorCore Clone — Feature Access Control Dashboard

## Context
Next.js 15 app at `~/Documents/Repositories/creatorcore-clone/webapp` (port 3009).
Prisma schema already has `Plan` model with feature flags, and `Client.planId` + `Client.featureOverrides`.
The existing `lib/features.ts` defines feature flags.
`@pratham7711/ui` is available with: Button, Card, Badge, StatCard, Input, Modal, EmptyState, Tag, Tooltip.

## Read first
1. Read `lib/features.ts` to understand the 10 feature flags
2. Read `app/(dashboard)/plans/` to understand what's already built
3. Read `prisma/schema.prisma` to understand the Plan + Client models

## Goals

### 1. Plans Management Page (enhance existing)

Read `app/(dashboard)/plans/PlansClient.tsx`. Completely rewrite it to be a full-featured plan management UI:

**Layout**: `padding: "32px 40px 40px"`

**Page header**: H1 "Plans & Feature Access" + subtitle "Manage subscription plans and feature access for clients"

**Top actions**: Button "New Plan" (primary, iconLeft Plus)

**Plans grid** (3 columns of plan cards):

Each plan card (Card variant="solid"):
```
Card header:
  - Plan name (bold, 18px)
  - Badge: variant="accent" if default, variant="success" if custom
  
Feature flags section:
  - Title: "Feature Access" (13px, muted, uppercase)
  - Grid of 2 cols, one row per feature:
    - Feature name (left)
    - Toggle switch (right) — shows enabled/disabled state
    - Disabled features are greyed out with Tag neutral "Off"
    - Enabled features have Tag variant="success" "On"

Footer:
  - "X clients on this plan" (muted)
  - Edit button (ghost sm)
  - Delete button (danger sm, disabled if clients are on it)
```

**New Plan Modal** (`Modal` component):
```
Title: "Create New Plan"
Size: "lg"

Fields:
  - Plan Name (Input required)
  - Description (Textarea)
  - Feature toggles section:
    - List all 10 feature flags with toggle switches
    - Feature names should be human-readable:
      - campaigns → Campaigns
      - creators → Creators
      - payouts → Payouts
      - reports → Reports
      - discovery → Creator Discovery
      - lists → Creator Lists
      - media_kits → Media Kits
      - fan_pages → Fan Pages
      - trackers → Trackers
      - activations → Activations
  
Footer: Cancel + Create Plan buttons
```

**Edit Plan Modal**: Same as New Plan but pre-filled.

**API routes** (create if they don't exist):
- `app/api/plans/route.ts`: GET (list all with client count) + POST (create)
- `app/api/plans/[id]/route.ts`: GET + PUT + DELETE

### 2. Feature Access Dashboard — NEW page

Create `app/(dashboard)/admin/page.tsx` and `app/(dashboard)/admin/FeatureAccessClient.tsx`

This is the main admin dashboard for managing feature access per client. It should be a powerful UI like a SaaS admin panel.

**URL**: `/admin`

**Page layout**: `padding: "32px 40px 40px"`

**Page header**:
- H1: "Feature Access" 
- Subtitle: "Manage plan assignments and feature overrides per client"
- Top right: Badge showing total clients count

**Tab nav** (Tag components):
- All Clients | By Plan | Overrides Only

#### Tab 1: All Clients view

A table/list showing all clients with their feature access status:

```
Card variant="solid" noPadding — full-width table:

Columns:
  CLIENT | PLAN | FEATURES ENABLED | OVERRIDES | ACTIONS

Per row:
  - Client avatar (36px circle, initials, bg #EEF2FF color #5B5BD6) + name
  - Plan badge (Badge variant="accent" with plan name, or Badge neutral "No Plan" if no plan)
  - Feature count "8/10 features" with a mini progress bar (inline div)
  - Override count: Badge variant="warning" "2 overrides" or nothing if no overrides
  - Actions: 
    - "Manage" Button variant="ghost" size="sm" → opens ClientFeatureModal
    - "View" Button variant="ghost" size="sm" → links to /clients/[id]
```

#### Tab 2: By Plan view

Group clients by their plan:

```
For each plan (or "No Plan"):
  - Section header: Plan name + client count badge
  - Client avatars listed inline (small, 28px, tooltip with name on hover)
  - "View all" link
```

#### Tab 3: Overrides Only view

Show only clients that have custom feature overrides:

```
Same table as Tab 1 but filtered to clients with overrides
Highlight which features are overridden
```

### 3. Client Feature Management Modal

This is the KEY component. Create `components/modals/ClientFeatureModal.tsx`:

```tsx
// Props
interface ClientFeatureModalProps {
  open: boolean
  onClose: () => void
  client: Client & { plan?: Plan | null }
  onSave: () => void
}
```

**Modal design**:
```
Title: "Feature Access — {client.name}"
Size: "lg"

Section 1: Plan Assignment
  - Current plan Badge or "No plan assigned"
  - "Change Plan" dropdown/select:
    - List all available plans
    - "No Plan" option
  - When plan changes: show preview of what features will be enabled/disabled

Section 2: Feature Overrides  
  - Subtitle: "Override individual features regardless of plan"
  - 10 feature rows, each with:
    - Feature name (left, 14px)
    - Current status (from plan) shown as small muted text "Plan: ON" / "Plan: OFF"
    - Override toggle:
      - 3 states: "Use Plan Default" | "Force ON" | "Force OFF"
      - Displayed as 3-segment pill selector
      - Colors: default=gray, force-on=green, force-off=red
    - Tooltip showing what the effective access will be

Section 3: Summary
  - "Effective access:" label
  - Row of feature badges (enabled=success outlined, disabled=neutral outlined)

Footer:
  - Cancel (secondary)
  - Save Changes (primary, loading state)
```

**Behavior**:
- Load client data on open
- On save: PUT /api/clients/[id]/features with { planId, featureOverrides }
- After save: call onSave() to refresh parent

**API route**: Create `app/api/clients/[id]/features/route.ts`:
```ts
// PUT — update plan assignment + feature overrides
export async function PUT(req, { params }) {
  const { planId, featureOverrides } = await req.json()
  const updated = await db.client.update({
    where: { id: params.id },
    data: { planId, featureOverrides: featureOverrides ? JSON.stringify(featureOverrides) : null }
  })
  return Response.json(updated)
}
```

### 4. Client Detail Page — feature access section

In `app/(dashboard)/clients/[id]/ClientDetailClient.tsx`, add a "Feature Access" tab:

When on the feature access tab:
- Show current plan assignment with badge
- Show all 10 features with ON/OFF status (using lib/features.ts `getClientFeatures` function)
- Show which features are from the plan vs overridden  
- "Manage Access" button that opens ClientFeatureModal

### 5. Sidebar — add Admin section

In `components/layout/NewSidebar.tsx`, add an "ADMIN" section at the bottom (above the user section):

```tsx
// Add after SETTINGS section:
{
  label: 'ADMIN',
  items: [
    { href: '/admin', icon: <Shield size={16} />, label: 'Feature Access' },
    { href: '/plans', icon: <CreditCard size={16} />, label: 'Plans' },
  ]
}
```

### 6. Bulk operations

Add to the Feature Access dashboard:

**Bulk assign plan**:
- Checkbox column on client table rows
- When 1+ selected: floating bottom bar appears:
  - "X clients selected"
  - "Assign Plan" dropdown
  - "Clear Overrides" button (danger)
  - "Apply" button (primary)
- API: PUT /api/clients/bulk-plan { clientIds: [], planId: string | null }

**Bulk clear overrides**:
- Same bottom bar: "Clear Overrides" removes all featureOverrides for selected clients

### 7. API routes to create/verify

Make sure these all exist and work correctly:

1. `app/api/plans/route.ts` — GET (with client count) + POST
2. `app/api/plans/[id]/route.ts` — GET + PUT + DELETE
3. `app/api/clients/[id]/features/route.ts` — GET + PUT
4. `app/api/clients/bulk-plan/route.ts` — PUT (bulk plan assignment)

All routes must:
- Check for authenticated session (`getServerSession`)
- Return proper HTTP status codes
- Handle errors gracefully

### 8. Seed more test data

Add to `prisma/seed.ts`:
- 3 plans: "Starter" (campaigns, creators, payouts), "Pro" (all features), "Enterprise" (all features + overrides)
- 5 clients with varying plan assignments and feature overrides
- 10 creators across different platforms

Re-run: `npx ts-node --project tsconfig.json prisma/seed.ts`
(Or use `tsx prisma/seed.ts`)

### 9. Build + commit

After everything is done:
```bash
cd ~/Documents/Repositories/creatorcore-clone/webapp
npm run build
```

Fix all TypeScript errors. Then:
```bash
git add -A
git commit -m "feat: feature access control dashboard + client plan management + bulk operations"
```

### 10. Create a NEEDS-HELP.md file

Create `~/Documents/Repositories/creatorcore-clone/webapp/NEEDS-HELP.md` listing:
- Anything that needs Pratham's input (e.g., real app credentials, OAuth setup)
- Any features that require external services
- Any design decisions that need approval
- Any database decisions

## Technical constraints
- TypeScript strict — no build errors
- All pages under `app/(dashboard)/` use the dashboard layout (sidebar + topbar)
- Use `getServerSession` from `next-auth` for auth checks in API routes
- Prisma client from `lib/db.ts`
- `"use client"` on all interactive client components

## When COMPLETELY finished, notify:
```bash
openclaw system event --text "Done: Feature access dashboard + client plan management + bulk operations — build passes clean" --mode now
```
