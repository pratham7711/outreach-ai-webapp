# Current Task

## Status: IN_PROGRESS

## Task: Phase A schema done — Session 2: Campaign Wizard + Posts Tab (parallel)

---

## Completed (this session):
- Schema Phase A migration landed (`b53d645`) — all new enums + models in one migration:
  - New enums: `PaymentMode`, `PaymentRelease`, `PostApprovalMode`, `DepositStatus`, `MediaType`, `PostStatus`, `PaymentGateway`, `DepositPaymentMethod`, `InviteChannel`, `InviteStatus`, `NegotiationStatus`, `PayoutRequestStatus`
  - Extended `PaymentMethod` enum: +UPI, NEFT, IMPS, RTGS, ENACH, WIRE
  - Extended `Campaign`: `paymentMode`, `paymentRelease`, `postApprovalMode`, `depositStatus`
  - Extended `Post`: `status` (PostStatus), `rejectionReason`, `mediaType`, `activationId`
  - Extended `Activation`: `posts Post[]` relation
  - New models: `CampaignDeposit`, `PayoutRequest`, `NegotiationOffer`, `CampaignInvite`
- Discovery gating, payout audit, entitlement cleanup (see git log)

---

## Next: Session 2 — Run TWO parallel tracks

### Track B — Campaign Creation Wizard
Replace `NewCampaignModal` with a 5-step wizard component.

**Steps:**
1. Basic info — title, client, thumbnail, notes
2. Campaign type — BUDGET_BASED / VIEW_BASED / OPEN_COMMUNITY / PRIVATE_INVITE + inline typeConfig form
3. Payment mode — toggle: Managed (we hold deposit) vs Self-managed (org tracks)
4. Payout model — sets `typeConfig.model`: fixed rate per post / per-1K-views with cap / negotiated
5. Settings — postApprovalMode (MANUAL/AUTO_APPROVED), paymentRelease (MANUAL/ON_POST_APPROVAL/ON_CREATOR_REQUEST), enrollmentOpen

**typeConfig shapes:**
```ts
// fixed rate
{ model: "fixed", ratePerPost: number, currency: string, maxPosts?: number }
// per view
{ model: "per_view", ratePerThousandViews: number, capAmount: number, currency: string, trackingWindowDays: number }
// negotiated
{ model: "negotiated", baseRate?: number, currency: string, allowCounterOffer: boolean }
```

**Files to create/edit:**
- `components/modals/CampaignWizard.tsx` — new 5-step wizard (use `@pratham7711/ui` Modal, Button, Input, Badge)
- `app/api/campaigns/route.ts` — accept `paymentMode`, `paymentRelease`, `postApprovalMode`
- `app/api/campaigns/[id]/route.ts` — accept same on PATCH
- Update `app/(dashboard)/campaigns/page.tsx` to use `CampaignWizard` instead of `NewCampaignModal` for new campaigns

**Lean test:** `__tests__/integration/campaigns.test.ts` (already exists — add: POST creates campaign with paymentMode field, GET still works)

---

### Track C — Campaign Posts Tab
Full posts view for a campaign: grid/list, approval workflow, URL submission.

**UI features:**
- Grid / list toggle
- Platform filter: All / TikTok / Instagram / YouTube
- Media type filter: All / Reel / Story / Post / Short
- Status tabs: Pending Review / Approved / Rejected / All
- Per-post card: thumbnail, creator name, platform icon, views, likes, comments, engagement rate, posted date, status badge
- Approve button / Reject button + reason modal — only shown when campaign `postApprovalMode === "MANUAL"`
- "Add Post" button → URL submission modal (URL, platform, media type, creator select)
- On URL submit → call `lib/platforms/fetchPostMetrics.ts` to pull initial stats

**URL → metrics helper (`lib/platforms/fetchPostMetrics.ts`):**
- Detect platform from URL pattern (youtube.com/watch, tiktok.com/@, instagram.com/reel)
- YouTube: YouTube Data API v3, `GET /videos?part=statistics,snippet&id=[videoId]&key=[YOUTUBE_API_KEY]`
- TikTok/Instagram: try oEmbed endpoint for basic stats; fall back to stub zeros if API key not available
- Returns: `{ platform, platformPostId, thumbnailUrl, caption, viewsCount, likesCount, commentsCount, engagementRate, postedAt }`

**API routes:**
- `app/api/campaigns/[id]/posts/route.ts` — GET (list posts), POST (submit URL → fetch metrics → create Post)
- `app/api/campaigns/[id]/posts/[postId]/route.ts` — PATCH (approve: set status=APPROVED / reject: set status=REJECTED + rejectionReason)

**Wire into campaign detail:**
- `app/(dashboard)/campaigns/[id]/page.tsx` — replace stub Posts tab with `<PostsTab campaignId={id} postApprovalMode={campaign.postApprovalMode} />`
- Create `app/(dashboard)/campaigns/[id]/PostsTab.tsx`

**Lean tests:**
- `__tests__/integration/campaignPosts.test.ts` — 401, POST creates post, PATCH approve/reject (3 cases)

---

## Execution for next agent

Spawn two background agents simultaneously:

**Agent 1 (Track B — Campaign Wizard):**
- Read `components/modals/NewCampaignModal.tsx` + `app/(dashboard)/campaigns/page.tsx` first
- Read `app/api/campaigns/route.ts` to understand current POST shape
- Build `CampaignWizard.tsx`, update API routes, update page
- Run `npm run build` — commit `feat: multi-step campaign creation wizard`

**Agent 2 (Track C — Posts Tab):**
- Read `app/(dashboard)/campaigns/[id]/page.tsx` (tab structure) first
- Read `prisma/schema.prisma` Post model to understand new fields
- Build `PostsTab.tsx`, `fetchPostMetrics.ts`, API routes
- Run `npm run build` — commit `feat: campaign posts tab with approval workflow`

After both: run `npm run build` final check, update this file.

---

## Context Files:
- `prisma/schema.prisma` — all new models/enums are landed (Post, Campaign, CampaignDeposit, etc.)
- `components/modals/NewCampaignModal.tsx` — existing modal to replace with wizard
- `app/(dashboard)/campaigns/[id]/page.tsx` — tab structure to wire PostsTab into
- `lib/entitlements.ts` + `lib/featureKeys.ts` — entitlement pattern reference
- `docs/OUTREACH_AI_PLAN.md` — full roadmap (Phases A-F)

## Blocker:
None. Schema is live on Neon PostgreSQL.

## Test:
```bash
npx jest --config jest.integration.config.js --runInBand __tests__/integration/campaigns.test.ts __tests__/integration/campaignPosts.test.ts
npm run build
```

---

## Architecture Decisions (locked — do not re-debate):
- Payment gateway: Razorpay (Indian: UPI/ENACH/RTGS/IMPS/NEFT) + Stripe (international cards/wire)
- All amounts displayed in USD; multi-currency deposit stored with `amountUsd` conversion
- Post submission: creator pastes URL → platform API fetches metrics
- Creator invite: Instagram DM automation + shareable link
- Payout models: all three (fixed, per-view-with-cap, negotiated) — set per campaign in wizard
- Post approval mode + payment release trigger: configurable per campaign at creation time

## Testing Policy:
Lean: 401 + happy path + one edge case per route. No 8-case suites until dedicated test sprint.
"Done" = builds clean + 3 tests pass + committed.
