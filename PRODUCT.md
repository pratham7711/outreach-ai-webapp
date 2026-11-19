# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Talent agencies and record labels that run paid creator campaigns on TikTok, Instagram, YouTube and Facebook: the campaign managers who brief creators, chase posts, report to clients and pay creators. Creators are a second audience: they connect their own accounts from a creator portal and browse open campaigns.

## Product Purpose
Made Boring Campaigns runs a creator campaign from pitch to payout in one record: shortlist and brief creators, track the posts they publish against the campaign, report to the client from the same rows, and reconcile payouts against verified performance. It replaces the spreadsheet plus folder of screenshots.

## Positioning
Every number traces back to a post a creator connected themselves: creators link their own accounts, so performance is read from the platform rather than retyped from screenshots, and the report and the payout come from the rows that were approved. Built for agencies and labels (sound trackers for music releases), not for brands buying influencers.

## Operating Context
Campaign managers work in the app daily: campaigns, creator roster, lists, sound trackers, calendar, analytics, payouts. Clients approve shortlists through one shared link. Creators connect accounts in their own portal and can disconnect there; nothing is posted on their behalf.

## Capabilities and Constraints
- Public site: landing page (/), marketplace of open campaigns (/explore), MCP page (/mcp), about, privacy, terms, data deletion. Self-serve sign-up at /signup; sign-in at /login.
- The landing page's "what we read" copy per platform must match the permissions the creator portal asks for (lib/portal/whatWeRead.ts); platform reviewers read the homepage.
- No customer logos, customer names, testimonials, or performance statistics may be shown: none are approved. Lkay Media (LKM) must not be named on the landing page, and no LKM data may appear on any public surface.
- Demo previews use invented data and must say so.

## Brand Commitments
- Name: Made Boring Campaigns, a Made Boring product (India). Brand constants live in lib/brand.ts.
- The landing page uses the app's own design world: the light theme's monochrome ink-on-white, the Satoshi typeface, the app's components. Confirmed 2026-11-19: monochrome like the app, no accent colour.
- Reference for energy and rhythm: lkaymedia.com (source: ~/Documents/Repositories/vibe-shift-agency-28/site/), the agency site built alongside it.

## Evidence on Hand
- Working interactive previews with invented, labelled data: hero views chart (app/LandingHeroVisual.tsx), sound trackers and shared shortlist (app/LandingDemos.tsx).
- No testimonials, customer logos, case studies, press or usage numbers exist. Do not fabricate them.

## Product Principles
- Prove with the product, never with claims: show the app doing the job, with demo data labelled as such.
- One record: every stage adds to the same campaign; copy and design should make that continuity visible.
- Creator consent is a feature: say plainly what is read, and that nothing is posted.
- The site and the app are one world: a visitor who signs up should land in the interface the page already showed them.

## Accessibility & Inclusion
WCAG 2.1 AA contrast; keyboard-operable demos; reduced-motion respected.
