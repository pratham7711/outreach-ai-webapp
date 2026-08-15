# Official TikTok routes for post metrics — research, 2026-08-12

**Outcome:** there is a better official API than the one we're on, and it is *application-based, not
invite-only*. It lives on the **TikTok for Business** plane (`business-api.tiktok.com`), not the
`developers.tiktok.com` plane our app review is sitting in. It is called the **Accounts API**, and
`/business/video/list/` returns per-post reach, watch-time and impression sources — fields the
Display API does not expose at all.

Nothing was sent or submitted. Everything below is verified against live docs through the VPN
(NL exit) on 2026-08-12; drafts are ready to submit on go-ahead.

---

## The five official routes, and which are real for us

| Route | What it gives | Verdict |
|---|---|---|
| **Display API** (`/v2/video/list/`, `/v2/video/query/`) — what we're on | views, likes, comments, shares for the **connected** creator's own videos | Already built. Keep. Floor, not ceiling. |
| **Accounts API** (TikTok for Business, Organic API suite) | per-post **video_views, likes, comments, shares, reach, full_video_watched_rate, total_time_watched, average_time_watched, impression_sources, audience_countries**; account-level followers/profile_views/audience_genders/audience_activity | **The target.** Open application. |
| **TikTok One API** (ex-TTCM) | Creator Marketplace creator data + creator discovery for Branded Content | Real, worth chasing after Accounts API. Old TTCM endpoints dead since 2025-06-30. |
| **Research API** | any public video's metrics by keyword/region/username, public account stats | **Ineligible.** Docs: "independent and academic researchers who conduct research on a not-for-profit basis". Emailing them wastes a cycle. |
| **Commercial Content API** | **paid ads only**, EU data only for now | Wrong product — we track organic posts. Open to "public and researchers", 2-working-day turnaround, `commercial-research-questions@tiktok.com`. |

### Accounts API — exact fields and latency

Source: `business-api.tiktok.com/portal/docs/accounts-insights-data-latency/v1.3`

`/business/video/list/`
- **No latency:** `item_id`, `create_time`, `thumbnail_url`, `share_url`, `embed_url`, `caption`
- **24–48h latency (UTC):** `video_views`, `likes`, `comments`, `shares`, `reach`, `video_duration`,
  `full_video_watched_rate`, `total_time_watched`, `average_time_watched`, `impression_sources`,
  `audience_countries`

`/business/get/`
- **No latency:** `username`, `display_name`, `profile_image`, `followers_count` (current total)
- **24–48h latency (UTC):** `audience_countries`, `audience_genders`, `likes`, `comments`, `shares`,
  `followers_count` (net gained that day), `profile_views`, `video_views`, `audience_activity`

Note the 24–48h latency: our sync cadence and any "live views" copy in the UI has to tolerate it.

### How access actually works

Since **2026-03-20** TikTok requires the **Accounts API Access Application Form** to be submitted
**before** you create the developer app or request the `TikTok Accounts` scope:

https://bytedance.sg.larkoffice.com/share/base/form/shrlgu4WEvtSXpEDLcCw56u4Rfc

Prerequisites, in order:
1. A **TikTok for Business** account (separate from the `developers.tiktok.com` account) —
   `business-api.tiktok.com/portal/developer/profile`
2. Business verification: an acceptable registration document **or** a Business Center ID with
   company info already verified
3. A screen recording of the feature that will consume the scope (prototype accepted if unbuilt)
4. Company website — and, if the SaaS product sits on a different domain, that one too

---

## Form field map (11 fields) with drafted answers

Fields marked `[NEEDS PRATHAM]` require facts I must not invent.

| # | Field | Draft |
|---|---|---|
| 1 | Business Name (legal, per registration) | `[NEEDS PRATHAM]` — legal entity name |
| 2 | Matches developer-profile Company Name? | Answer after the TikTok for Business profile exists |
| 3 | App Name | `Outreach AI` (must match the app registered on business-api) |
| 4 | Email of TikTok for Business account | `[NEEDS PRATHAM]` — must be the exact registration email |
| 5 | Website | `https://madeboring.com` (**not live — apex has no DNS**), SaaS URL `https://campaign.madeboring.com` |
| 6 | Business verification method | `[NEEDS PRATHAM]` — registration doc vs Business Center ID |
| 7 | Use case | draft below |
| 8 | Screen recordings | record the campaign → Posts tab → per-post metrics flow on sandbox |
| 9 | Estimated count of authorising accounts | `10 - 200` (pilot-honest; overstating invites scrutiny) |
| 10 | Developer account type | `Technology Company` (we ship software others use; not an ad agency, not a direct advertiser) |
| 11 | Usage acknowledgment + revocation consent | Agree |

### Field 7 — use case draft

> Outreach AI is a campaign-management SaaS for music labels and talent agencies. A brand or label
> runs an influencer campaign, invites creators, approves their drafts, and then needs verified
> performance data for the posts those creators publish under the campaign.
>
> Creators authorise our app themselves from their own creator portal. We use the granted scope to
> read reach and engagement for **only the posts belonging to campaigns they have joined**, so the
> agency sees campaign performance without asking creators for screenshots — today the alternative
> is creators manually sending screenshots, which cannot be verified and cannot be aggregated.
>
> API integration is necessary rather than the native TikTok for Business platform because a single
> campaign spans many independent creator accounts across several brands. No native surface
> aggregates post performance across accounts a brand does not own, applies per-campaign
> attribution, or drives creator payouts calculated from verified views. Payout accrual is computed
> from these metrics, so a manual/native workflow cannot serve the product.
>
> We request read-only access. We do not resell raw TikTok data; metrics are shown only to the
> creator who authorised the connection and the brand running that specific campaign.

---

## Correction to what I said earlier about messaging

I said TikTok has no send-message API. That was right for the `developers.tiktok.com` plane and
wrong overall: **TikTok Business Messaging API** (Organic API suite) lets authorised **Business
Accounts** send and receive DMs with TikTok users via API-integrated platforms — Open Beta in
APAC / LATAM / METAP / North America, gated behind data-security and privacy reviews.

It is built for customer engagement on a business's own account, so cold-outreach to creators is
almost certainly outside its allowed usage — that needs confirming against its "Access to Business
Messaging API" and allowed-usage pages before anyone builds on it. The capability exists; the
permission to use it for prospecting does not follow automatically.

---

## Recommended sequence

1. **Do not email** `Research-API@tiktok.com` (we fail the non-profit test) or
   `commercial-research-questions@tiktok.com` (ads-only, EU-only). Both return "wrong product".
2. Create the **TikTok for Business** developer profile + complete business verification.
3. Deploy the landing site at `madeboring.com` so fields 5 has a real website — the same blocker
   already holds up the `developers.tiktok.com` review (`campaign.madeboring.com/` 302s to `/login`).
4. Record the metrics flow (field 8).
5. Submit the Accounts API form. Then create the business app and request `TikTok Accounts`.
6. Separately pursue **TikTok One API** for creator discovery once the business profile exists.

The `developers.tiktok.com` Display API review continues in parallel and is unaffected — the two
planes have separate accounts, apps, and reviews.

---

## How Whop does it (checked 2026-08-12)

Short answer: **the same architecture we already have — official OAuth account connections — not
scraping.** Whop's own API is the evidence.

`docs.whop.com/api-reference/beta/users/user.md` exposes `social_accounts[]` on the User object:

- `platform` — one of `x`, `instagram`, `youtube`, `tiktok`, `facebook`, `discord`, `telegram`
- `external_id` — "the platform-specific ID for this social account"
- `parent_social_account` — "the social account this one belongs to on the platform, **such as the
  Facebook page that owns an Instagram account**" → that is exactly the Meta Graph API's
  IG-Business-behind-a-Page requirement, which only exists if you are on Meta's official API
- `error` — "why this social account currently can't be used for advertising — a failed share or a
  **Meta-side restriction**" → they surface Meta's own API errors to users

Content Rewards flow, per `docs.whop.com/memberships-and-access/third-party-apps/content-rewards`:
creator posts to their own social account → pastes the link into Whop → brand **approves** the
submission → "Whop automatically pays the content creator based on the number of views they got."
Campaign config has an explicit **platform selection** step (which platforms submissions are
accepted from) and a $/1,000-views rate plus optional flat fee.

Their public Bounties API (`/bounties`, `bnty_` IDs) is the generalised version: reward escrowed at
publish, `accepted_deliverable_types` of `content_url` (posted links) / `media` / `data_capture`,
`business_goal_type` including `clipping` and `post_engagement`, N winner slots, human approval per
submission. Notably the **public Bounty schema carries no view-count or platform fields at all** —
per-view accrual is internal to the Content Rewards app, not exposed.

**Evidenced:** Whop holds official OAuth connections to TikTok/IG/YouTube/X/Facebook and stores
platform user IDs. **Not documented publicly, therefore inferred:** that the view number driving
payout is read from those connections for the poster's own post. Whop does not publish the counting
mechanism, and a submitted `content_url` from an account the worker has *not* connected would need
some other source — so a scraping or vendor fallback for that case cannot be ruled out.

Implication for us: we are not behind on architecture. The gap is data richness — Whop pays on a
plain view count, which the Display API already gives us. TikTok's Accounts API would put us ahead
of that (reach, watch-time, impression sources), not level with it.
