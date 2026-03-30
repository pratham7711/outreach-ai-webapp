# Current Task

## Status: TODO

## Task: Phase 4 — Wire Campaign Detail Tabs with Real Data

---

## Completed (previous session):
- PostgreSQL migration (Neon), all foundation models, seed data
- Campaign type selector (4 types), Team invites, API key management, SDUI dashboard
- 393 tests passing (166 unit + 189 integration + 38 E2E), build clean
- All 12 API routes return 200, all pages render with real data

---

## Next:
**Wire the campaign detail page tabs to show real related data**

### Exact steps:

#### 1. Creators tab (`/campaigns/[id]` → Creators tab)
- Fetch activations for this campaign via `db.activation.findMany({ where: { campaignId } })` with creator includes
- Display creator cards with: name, handle, platform, status badge, rate
- Add "Add Creator" button that creates an activation (assign creator to campaign)
- File: `app/(dashboard)/campaigns/[id]/page.tsx` — read the existing tab structure

#### 2. Posts tab
- Fetch posts for this campaign via `db.post.findMany({ where: { campaignId } })`
- Display post cards with: platform, URL, views, likes, engagement rate, posted date
- File: same as above

#### 3. Budget/Financials tab
- Fetch `CampaignFinancials` + payouts for this campaign
- Show: total budget, spent, remaining, payout breakdown per creator
- File: same as above

#### 4. Write tests
- `__tests__/integration/campaignDetail.test.ts` — test GET /api/campaigns/[id] returns activations, posts, financials
- Update existing campaign detail tests if needed

#### 5. Verify
```bash
npx jest --config jest.integration.config.js
npm run build
PORT=3009 npm run dev  # → /campaigns/camp-1 shows real creators, posts, financials
```

## Context Files:
- `app/(dashboard)/campaigns/[id]/page.tsx` — campaign detail page with tabs
- `app/api/campaigns/[id]/route.ts` — campaign detail API
- `prisma/schema.prisma` — Activation, Post, CampaignFinancials models

## Blocker:
None

## Test:
Visit `/campaigns/camp-1` → Creators tab shows Blessing Jolie + Alex Turner (from seed activations) → Budget tab shows $25,000 budget
