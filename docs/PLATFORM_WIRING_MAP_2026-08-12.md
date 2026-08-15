# Platform registry wiring map (task #37)

Goal: replace ~24 scattered hardcoded 4-value platform lists with the single source of truth `lib/platforms/registry.ts` (PLATFORM_KEYS = 10 values; platformLabel/BrandColor/Tone/isAutoTracked/detectPlatformFromUrl). Prisma `Platform` enum + sandbox DB + client already extended to 10 values this session.

## Wiring order (highest-value → lowest-risk first)
1. **z.enum validators (WRITE-path)** → `z.enum(PLATFORM_KEYS)`. Sites:
   `app/api/portal/auth/register/route.ts:13` · `app/api/portal/me/route.ts:49` · `app/api/creators/[id]/route.ts:11` · `app/api/creators/route.ts:11,19` · `app/api/creators/[id]/social-accounts/route.ts:46` · `app/api/campaigns/[id]/route.ts:18` (MARKETPLACE_PLATFORMS) · `lib/ai/tools/registry.ts:10`. Also `app/api/discovery/route.ts:12` is `z.string()` (no allowlist) — add PLATFORM_KEYS check.
2. **Hardcoded arrays feeding WRITE paths** → spread `PLATFORM_KEYS`: `app/api/campaigns/[id]/posts/route.ts:11` · `lib/marketplace/public.ts:174` · `app/(dashboard)/creators/[id]/page.tsx:374,804` (inline).
3. **Color/label/tone maps** → registry helpers; delete: `lib/format.ts:30-42` · `app/(dashboard)/analytics/shared.ts:46-59` (`PLATFORM_PALETTE`/`platformColor` — best delete candidate, registry has chartVar) · `components/ui/PlatformBadge.tsx:3-9` · `app/(dashboard)/creators/[id]/page.tsx:22-27` (hex DRIFT vs registry) · `app/(dashboard)/campaigns/[id]/PostsTab.tsx:75-80` (tones already match registry) · `app/(public)/explore/format.ts:4-9` · `app/(public)/c/[handle]/page.tsx:40-46` (already has 5th key TWITCH → proves drift).
4. **UI filter arrays** → derive from registry: `app/(dashboard)/discovery/page.tsx:11` · `creators/CreatorsClient.tsx:28-34` · `campaigns/self-serve/SelfServeWizard.tsx:12` · `campaigns/[id]/PostsTab.tsx:59` (drops TWITTER) · `analytics/shared.ts:22-27` (drops TWITTER) · `app/(public)/explore/MarketplaceFilters.tsx:6-12` · `app/api/analytics/route.ts:6` · `app/api/analytics/campaigns/route.ts:11`.
5. **Pickers** → build ONE `<PlatformSelect>` (none exists; ~10 hand-rolled `<select>`s): AddCreatorModal, creators/[id], portal/settings, MarketplaceFilters, SelfServeWizard, PostsTab, campaigns/[id] rate grid.

## Do NOT blindly swap to 10 values (legit smaller subsets — gate on `AUTO_TRACK_PLATFORMS` or keep curated):
- `lib/platforms/fetchPostMetrics.ts` `detectPlatform` (3-value; only 3 fetchers exist) — **reuse registry's `detectPlatformFromUrl` for classification** (it's a superset; also recognizes IG /reels/ plural + /tv/), but keep the 3-platform gate for actual metric fetching. Callers: `portal/campaigns/[slug]/submissions/route.ts:33`, `campaigns/[id]/posts/route.ts:110`, `cron/sync-posts/route.ts:102,188`. registry.detectPlatformFromUrl has **0 callers today** (dead until wired).
- `lib/oauth/providers.ts:1` OAUTH_PLATFORMS (only 3 have OAuth apps) · `lib/metrics/emv.ts:3` EmvPlatform (no EMV cards for others) · `lib/reports/campaignPerformance.ts` SERIES_PLATFORMS · `lib/marketplace/earnings.ts:3` (PlatformKey name-COLLIDES with registry) · `app/api/connections/route.ts:6-20` (mixed social+messaging+payment list — only first 4 are platforms).
- §6 branches (`if platform === "TIKTOK"` in cron/sync-posts, portal/connections revoke, posts token-picker, creators/[id] TikTok video section) stay until Facebook/Twitch/etc. get real integrations.

Full detail: see session transcript 2026-08-12 (Explore agent, 68 tool-uses).
