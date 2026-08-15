# Product Plan — Agency & Brand Features

**Date:** 2026-08-10
**Context:** Multi-tenant influencer-campaign SaaS for music labels + talent agencies. This plan covers features useful to the two paying sides (agencies, brands/labels), the requested AI-outreach feature, and the fate of `/trackers` — sequenced for cost-effectiveness.

---

## Framing: what actually differentiates us

CreatorCore (the reference product) is, on the evidence gathered this session, built on a **commodity public scraper feeding its own Elasticsearch** — full stats for a brand-new 0-follower video that never authorized them, discovery served from a pre-ingested index, media re-hosted on CloudFront. **Their data is not a moat.** Any of EnsembleData / ScrapeCreators / Apify reproduces it for cents.

Our edge is the thing a scraper can't produce: **first-party verified data from creators who connect their accounts** (the Phase 0 work), plus an **AI layer that's already ~70% built** (`lib/ai/*`: authenticity, brandFit, roi, audience, pricing/rateCard, discovery, reports, contracts, outreach, safety). So this plan is deliberately **wire-what-exists first**, net-new last.

**One cheap data provider covers every non-connected need.** ScrapeCreators (pay-as-you-go, 100 free credits, cached hits = 0) powers the Sound Tracker, non-connected creator stats, and non-connected post metrics. Avoid Modash ($16.2k/yr) until discovery-at-scale is a proven demand.

---

## Phase A — Wire what's already built *(near-zero cost, highest leverage)*

### A1. Sound Tracker → ScrapeCreators adapter  *(resolves task #9)*
The `TikTokSound`/`SoundTrackerSnapshot` schema already wants `usesCount` → velocity. ScrapeCreators `GET /v1/tiktok/song/videos` returns exactly that. Wire it behind an env flag, same pattern as the SocialKit fallback in `fetchPostMetrics.ts`; a daily cron writes snapshots.
- **Reuses:** existing schema, cron pattern. **New:** one adapter (~80 lines) + cron entry.
- **Cost:** validate on the 100 free credits before any subscription.

### A2. AI creator outreach  *(the requested feature)*
`lib/ai/outreach/draftOutreach.ts` already exists — draft-only, anti-hallucination, approval-gate-aware — but is **wired to nothing**. Finish it: targeting UI (pick creators from roster/discovery) → AI drafts personalised invites grounded in the campaign brief + the creator's own evidence → **queue, never auto-send** → operator approves → deliver via the `Message` model (in-app) or the local `send-email` toolkit.
- **Reuses:** `draftOutreach.ts`, `Message` model, brandFit/audience for targeting.
- **Hard rule baked in:** nothing sends without explicit per-batch approval; volume caps; only creators with a contact channel.

### A3. Deliverable / brief-compliance auto-check
Campaigns already carry requirements ("public account, use the sound, stay live 30d") and posts already sync metrics with a `PENDING_REVIEW` status. Auto-flag: posted after deadline, sound missing, went private/deleted, below a min-views floor.
- **Reuses:** post sync, `PostStatus`, sound data from A1. **New:** a rules check in the sync path.

---

## Phase B — Agency monetization *(reuse whitelabel + reports)*

### B1. White-label client reporting portal
`/share/[token]` + `SharedPerformanceReport` + `lib/ai/whitelabel/theme.ts` already exist. Extend to **per-client live campaign dashboards under the agency's brand** — the thing agencies resell to their brand/label clients.
- **Reuses:** share tokens, whitelabel theme, `/api/reports`. **New:** client-scoped dashboard view + branding config.

### B2. Margin & invoicing
Agencies take a cut. Track agency margin on `ViewLedger`/payouts, generate an invoice to the brand client, reconcile revenue vs creator payout.
- **Reuses:** ViewLedger, payout-calculator, deposits. **New:** margin field + invoice generation.

---

## Phase C — Brand/label differentiation *(net-new, gated on a real customer ask)*

### C1. Verified-reach reports  *(the actual moat vs CreatorCore)*
Badge connected-creator numbers as **Verified** vs scraped numbers as **Estimated**. This is the one thing CreatorCore structurally cannot show. Directly leverages the Phase 0 connect flow.
- **Reuses:** connect flow, insights API, reports. **Depends on:** connect-rate being non-trivial (chicken-and-egg — see risks).

### C2. AI campaign brief → creator matching
Describe a campaign; AI ranks roster + marketplace creators by fit. `brandFit`, `audience/intelligence`, and `discovery` already exist — this is mostly orchestration.
- **Reuses:** `lib/ai/scoring/brandFit`, `audience`, `discovery`.

### C3. Attribution smart-links *(optional, largest scope — deprioritized)*
Labels care about streams/saves, not just views. True attribution needs a link-tracking build or a Feature.fm/Linkfire-style integration. **Explicitly deferred** — big surface, unproven demand.

---

## Cross-cutting
- **Gate premium features** (B1, B2, C1, C2) via the existing `entitlements`/`features`/`Plan` system — turns them into upsells.
- **One provider** (ScrapeCreators PAYG) for all non-connected data; connected creators stay free via official APIs.

## Cost model
| Item | Recurring cost |
|---|---|
| Connected-creator data (creators/posts) | **$0** (official APIs, already built) |
| Sound Tracker + non-connected data | ScrapeCreators PAYG (100 free credits first) |
| AI features | existing per-call metering (`lib/ai/metering`) |
| Everything in Phase A/B | **$0 new infra** — wiring existing code |
| Modash / HypeAuditor / music-analytics | **avoid** until a customer demands discovery-at-scale or cross-platform |

---

## Adversarial review

- **Biggest risk: building features nobody asked for.** Only **A1–A3** are unambiguously worth doing now (A1 fills a known gap, A2 was explicitly requested, A3 is pure reuse). **B and C should be gated on a real agency/brand asking** — don't build the white-label portal on spec.
- **A2 is a spam/deliverability/consent hazard.** Mitigated by the already-designed hard approval gate + volume caps + contactable-creators-only. Never loosen this.
- **C1's value is proportional to connect-rate.** If few creators connect, "Verified" is empty and the moat is theoretical. C1 depends on Phase 0 succeeding first — sequence accordingly.
- **A1 only matters if labels use the Sound Tracker.** Validate against the 100 free credits and a real "would you use this?" before subscribing to any provider.
- **C3 is a rabbit hole.** Named only to explicitly park it.

## Recommended sequence
1. **A1** (resolves task #9, ~free) → **A2** (requested, composer exists) → **A3** (pure reuse).
2. Then pause and get a real agency/brand in front of it before **B1/B2**.
3. **C1** only once connect-rate is proven; **C2** as an AI upsell; **C3** parked.
