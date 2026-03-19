# Task: CreatorCore Clone — Full UI Polish + @pratham7711/ui Integration

## Context
This is a Next.js 15 app at `~/Documents/Repositories/creatorcore-clone/webapp` (port 3009).
It's a pixel-perfect clone of the real CreatorCore (app.creatorcore.co) with a light theme.

## Primary Goals (do ALL of these, in order)

### 1. Override @pratham7711/ui CSS tokens for light theme

In `app/globals.css`, add a `:root` override block AFTER the existing tailwind import to remap all `--ui-*` tokens to the light theme:

```css
/* ── @pratham7711/ui token overrides for light theme ── */
:root {
  --ui-accent: #5B5BD6;
  --ui-accent-dim: rgba(91, 91, 214, 0.25);
  --ui-accent-glow: rgba(91, 91, 214, 0.12);

  --ui-bg-0: #EFF0F8;
  --ui-bg-1: #FFFFFF;
  --ui-bg-2: #F3F4F8;
  --ui-bg-3: #E8EAF4;

  --ui-text-0: #1C2048;
  --ui-text-1: rgba(28, 32, 72, 0.75);
  --ui-text-2: rgba(28, 32, 72, 0.45);

  --ui-border: #E4E6F0;
  --ui-border-strong: #D0D3E8;

  --ui-glass: rgba(255, 255, 255, 0.9);
  --ui-glass-border: #E4E6F0;

  --ui-shadow-sm: 0 1px 4px rgba(28, 32, 72, 0.06);
  --ui-shadow-md: 0 4px 16px rgba(28, 32, 72, 0.08);
  --ui-shadow-lg: 0 8px 32px rgba(28, 32, 72, 0.12);
  --ui-glow: 0 0 24px var(--ui-accent-glow);

  --ui-font: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

Also add the import at top of globals.css:
```css
@import '@pratham7711/ui/styles';
```
(Add this AFTER `@import "tailwindcss";`)

### 2. Fix all page headers (padding)

Every `*Client.tsx` page's outermost `<div>` needs proper padding so content isn't hidden under the top bar (which is 64px tall). The fix for each:

**CampaignsClient.tsx**: Change outermost div from `<div>` to:
```tsx
<div style={{ padding: "32px 40px 40px" }}>
```

**CreatorsClient.tsx**: Same fix

**ClientsClient.tsx**: Same fix — the current outermost `<div>` has no padding, add `style={{ padding: "32px 40px 40px" }}`

**PayoutsClient.tsx**: Same fix — add padding to outermost div

**DashboardClient.tsx**: Same fix

**DiscoveryClient.tsx**: Same fix

**ListsClient.tsx**: Same fix

**ActivationsClient.tsx**: Same fix

**CalendarClient.tsx**: Same fix

**TrackerClient.tsx** (in `trackers/`): Same fix

**ReportsClient.tsx**: Same fix

**ConnectionsClient.tsx**: Same fix

### 3. Replace inline-styled elements with @pratham7711/ui components

Go through each `*Client.tsx` file and replace:

- Any `<button ...>` → `<Button>` from `@pratham7711/ui`
  - Primary action buttons (like "New Campaign", "Add Client"): `variant="primary"`
  - Secondary/utility buttons: `variant="secondary"`  
  - Ghost buttons: `variant="ghost"`
  - Danger actions: `variant="danger"`
  - With icons: use `iconLeft={<Plus size={16} />}` prop

- Any stat metric cards → `<StatCard value={...} label={...} trend="up" trendLabel="+8% from last month" icon={...} />`

- Any empty state divs (no data messages) → `<EmptyState icon="..." title="..." description="..." action={<Button variant="primary">...</Button>} />`

- Any status badge spans → `<Badge variant="success|warning|danger|neutral|accent" dot>Active</Badge>`

- Any card container divs (white bg, border, borderRadius) → `<Card variant="solid" noPadding>...</Card>`

- Any search inputs → `<Input placeholder="Search..." iconLeft={<Search size={16} />} />`

- Any tag/chip elements → `<Tag>...</Tag>` or `<Tag outlined>...</Tag>`

- Any modals → `<Modal open={...} onClose={...} title="..." size="md" footer={...}>`

**Import pattern for each file:**
```tsx
import { Button, Card, Badge, StatCard, Input, EmptyState, Tag, Modal } from '@pratham7711/ui'
```

### 4. CampaignsClient.tsx full rewrite

This is the most important page. Make it match the real CreatorCore exactly:

```
LAYOUT:
- Page padding: 32px 40px 40px
- H1: "Campaigns" (28px, 700, --cc-text)
- Subtitle: "Manage and track your influencer campaigns"
- Top actions row: [Search input left] [Folders btn] [New Campaign btn right]
  - Search: Input with iconLeft search icon, placeholder "Search campaigns..."
  - Folders: Button variant="secondary" iconLeft={<FolderOpen />}
  - New Campaign: Button variant="primary" iconLeft={<Plus />}

STATS ROW (4 stat cards in a grid):
- Total Campaigns / Active / Creator Reach / Total Budget
- Use StatCard component

STATUS TABS:
- Row of pill tabs: All | Pending | Active | Complete | Cancelled
- Each tab is a Tag component with clickable=true + custom background override via style prop
- Active tab: bg #EEF2FF, color #4F46E5, fontWeight 600
- Inactive: bg #F3F4F6, color #6B7280

TABLE (inside Card variant="solid" noPadding):
- Header row: Campaign / Status / Budget / Client / Activations / Actions
- Each row: campaign name + icon, status Badge, budget, client name, activation count, kebab menu
- Status colors: PENDING=warning, IN_PROGRESS=accent, COMPLETE=success, CANCELLED=danger

EMPTY STATE (when no campaigns):
- EmptyState icon="🎯" title="No campaigns yet" description="Create your first campaign to get started" action={<Button variant="primary" iconLeft={<Plus />}>New Campaign</Button>}
```

### 5. ClientsClient.tsx full rewrite

```
LAYOUT:
- Page padding: 32px 40px 40px
- H1: "Clients" (28px, 700)
- Subtitle: "Manage your client relationships and billing"

TOP BAR:
- Left: Input search with iconLeft search icon
- Right: Button variant="primary" iconLeft={<Plus />} "Add Client"

STATS (2 StatCards):
- Total Clients
- Total Campaigns

TABLE (Card variant="solid" noPadding):
- Logo avatar (circle, 36px, initials if no logo, bg #EEF2FF, color #5B5BD6)
- Client Name (bold)
- Campaigns count (muted)
- Badge for plan (if client has plan)
- View button (Button variant="ghost" size="sm")
- Each row is a Link to /clients/[id]

EMPTY STATE:
- EmptyState icon="🏢" title="No clients yet" description="Add your first client to start managing campaigns" action={<Button variant="primary" iconLeft={<Plus />}>Add Client</Button>}
```

### 6. CreatorsClient.tsx full rewrite

```
LAYOUT:
- Page padding: 32px 40px 40px
- H1: "Creators"
- Subtitle: "Discover and manage your creator roster"

TOP BAR: 
- Search input
- Filter by platform dropdown (Tag components for platform filter: All | Instagram | YouTube | TikTok | Twitter)
- Add Creator button (primary)

GRID (3 cols):
- Creator cards: Card variant="solid"
  - Avatar (40px circle, platform badge overlay bottom-right)
  - Name (bold) + @handle
  - Platform Badge (accent for IG, danger for YT, neutral for TT)
  - Followers count formatted (1.2M, 230K)
  - Engagement rate
  - "View Profile" Button variant="ghost" size="sm"

EMPTY STATE:
- EmptyState icon="👥" title="No creators yet" description="Add creators to your roster" action={<Button variant="primary" iconLeft={<Plus />}>Add Creator</Button>}
```

### 7. PayoutsClient.tsx full rewrite

```
LAYOUT:
- Page padding: 32px 40px 40px
- H1: "Payouts"
- Subtitle: "Track and manage creator payments"

STATS (3 StatCards):
- Total Paid (trend="up")
- Pending Amount (trend="neutral")
- Total Processed

TOP BAR:
- Search input
- Filter by status Tags: All | Pending | Sent | Failed
- Process Payout button (primary)

TABLE (Card variant="solid" noPadding):
- Creator name + avatar
- Campaign name
- Amount
- Status Badge: PENDING=warning dot, SENT=success dot, FAILED=danger dot
- Date (formatted)
- Actions (kebab)

EMPTY STATE:
- EmptyState icon="💸" title="No payouts yet" description="Process your first creator payment"
```

### 8. DashboardClient.tsx improvements

```
LAYOUT:
- Page padding: 32px 40px 40px
- H1: "Dashboard"
- Subtitle: "Welcome back! Here's what's happening."

STATS ROW (4 cards using StatCard):
- Active Campaigns
- Active Creators  
- Pending Payouts
- Growth

RECENT CAMPAIGNS + ACTIVITY FEED (two-col):
- Left: Card variant="solid" with "Recent Campaigns" table
- Right: Card variant="solid" with "Activity Feed"

Empty states use EmptyState component.
```

### 9. DiscoveryClient.tsx rewrite

```
LAYOUT: 32px 40px 40px padding
H1: "Discovery"
Subtitle: "Find and connect with creators"

SEARCH BAR (full width, prominent):
- Large Input with search icon, placeholder "Search by name, niche, or platform..."

FILTER TAGS ROW:
- Platform: Tag clickable for Instagram / YouTube / TikTok / Twitter / All
- Niche: Gaming / Beauty / Tech / Lifestyle / All

CREATOR GRID (Card grid, 3-4 cols):
- Same card design as Creators page

EMPTY STATE with EmptyState component.
```

### 10. ListsClient.tsx improvements

```
LAYOUT: 32px 40px 40px padding
H1: "Lists"
Subtitle: "Organize creators into curated lists"

TOP BAR: [Search] [New List btn primary]

LIST GRID (2-3 cols):
- Card variant="solid" clickable
- List name (bold)
- Creator count with avatar stack preview
- Created date
- Edit/Delete actions

EMPTY STATE with EmptyState component
```

### 11. ActivationsClient.tsx improvements

```
LAYOUT: 32px 40px 40px padding
H1: "Activations"
Subtitle: "Track creator deliverables and posts"

STATUS TABS using Tag components

TABLE:
- Creator | Campaign | Content Type | Due Date | Status | Actions
- Status Badge: DRAFT=neutral, POSTED=success, PENDING=warning, REJECTED=danger

EMPTY STATE with EmptyState component
```

### 12. Reports, Requests, Connections, Calendar, Trackers, Media Kits, FanPages pages

For each of these pages:
1. Add `style={{ padding: "32px 40px 40px" }}` to the outermost div
2. Add a proper H1 header and subtitle
3. Replace any raw buttons/cards with @pratham7711/ui components
4. Add proper EmptyState components where there's no data

### 13. NewCampaignModal.tsx and other modals

Replace any custom modal HTML with `<Modal>` from @pratham7711/ui:
```tsx
import { Modal, Button, Input } from '@pratham7711/ui'
// ...
<Modal open={showModal} onClose={() => setShowModal(false)} title="New Campaign" size="md"
  footer={
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
      <Button variant="primary" loading={isLoading}>Create Campaign</Button>
    </div>
  }
>
  <Input label="Campaign Name" placeholder="Enter campaign name..." />
  {/* ...more fields... */}
</Modal>
```

### 14. Build NewClientModal and NewCreatorModal components

Create `components/modals/NewClientModal.tsx`:
- Modal title: "New Client"
- Fields: Name (required), Contact Email, Website, Logo URL
- On submit: POST to /api/clients
- Use Modal + Input + Button from @pratham7711/ui

Create `components/modals/NewCreatorModal.tsx`:
- Modal title: "Add Creator"
- Fields: Name (required), Handle (required), Platform (select: Instagram/YouTube/TikTok/Twitter), Followers, Engagement Rate, Bio
- On submit: POST to /api/creators
- Use Modal + Input + Button from @pratham7711/ui

Wire these into ClientsClient.tsx and CreatorsClient.tsx respectively.

### 15. Build a full-featured NewCampaignModal

Rewrite `components/modals/NewCampaignModal.tsx` to be fully functional:
- Fields: Title (required), Description, Client (dropdown from API), Budget, Currency (USD/EUR/GBP), Status (Pending/Active/Complete/Cancelled)
- On submit: POST to /api/campaigns, then router.refresh() to update the list
- Use Modal + Input + Button from @pratham7711/ui

### 16. tailwind.config.ts — extend theme

Create `tailwind.config.ts` at root with:
```ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'cc-bg': '#EFF0F8',
        'cc-card': '#FFFFFF',
        'cc-border': '#E4E6F0',
        'cc-primary': '#5B5BD6',
        'cc-primary-hover': '#4A4AC8',
        'cc-text': '#1C2048',
        'cc-text-muted': '#9097B4',
        'cc-text-subtle': '#C4C9E0',
        'cc-navy': '#1E1B4B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
}

export default config
```

### 17. After all changes: run the build

```bash
cd ~/Documents/Repositories/creatorcore-clone/webapp
npm run build
```

Fix ALL TypeScript errors and build failures. The build MUST pass clean.

### 18. Git commit everything

```bash
cd ~/Documents/Repositories/creatorcore-clone/webapp
git add -A
git commit -m "feat: full @pratham7711/ui integration + pixel-perfect UI polish"
```

## Technical constraints
- TypeScript strict mode — no `any` without explicit cast
- All client components need `"use client"` directive
- Next.js 15 App Router — no `useRouter` from `next/router` (use `next/navigation`)
- Tailwind v4 is installed — utility classes work, but also use inline styles for design token values
- Port: 3009
- DB: SQLite at `prisma/dev.db`

## When COMPLETELY finished, notify:
```bash
openclaw system event --text "Done: Full @pratham7711/ui integration + all pages polished — build passes clean" --mode now
```
