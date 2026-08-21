# Trackers build plan — Audios + Creators

Spec: `CREATORCORE_FULL_PRD_2026-08-12.md` §4.9. This file is the build order and
the exit criteria. Flip a box only when its check passes.

## The problem being solved

`/trackers` looks built and is not. `SoundTrackerSnapshot` has exactly one writer,
`prisma/seed.ts`. On a seeded box the numbers look real and never move; on
production there is no data at all. The Creators tracker type does not exist.
Trackers are the music-label wedge, so this is the surface a label evaluates us on.

## Ordering constraint

`prisma/schema.prisma` is shared with the session building fraud `flagState` and
`score`. Phase A needs **no** schema change and goes first for that reason, not
because it is more valuable. Phase B claims the schema when that session is clear.

---

## Phase A — make the sound tracker real (no schema change)

- [ ] **A1 — `lib/trackers/metrics.ts`, pure.**
  `deltaFrom(previous, latest)`, `velocityPerHour(previous, latest)`,
  `changeOverWindow(snapshots, hours)`, `statusFor(velocity)`.
  Unknown is `null`, never `0`. A single snapshot yields `null` change, not 0%.
  EXIT: unit tests green, including the single-snapshot and equal-timestamp cases.

- [ ] **A2 — `lib/platforms/tiktokSound.ts`.**
  Fetch a sound page, parse the video count from the same rehydration payload
  `parseTikTokRehydration` already handles. Returns `null` on unavailable sound,
  missing script, or malformed JSON. Never throws.
  EXIT: unit tests over saved fixtures; a real fetch is not testable from India.

- [ ] **A3 — ingestion sweep `app/api/cron/sync-trackers/route.ts`.**
  `CRON_SECRET`-guarded. Reads tracked sounds, fetches, writes one
  `SoundTrackerSnapshot` per sound with deltas computed from the previous row.
  Skips a sound already snapshotted within the window. Records `syncSource`.
  Settlement-class: must never consume `SyncSlot` capacity.
  EXIT: dry-run returns a decision list without writing; live run writes one row.

- [ ] **A4 — period toggle + velocity sort.**
  `/api/trackers?period=24h|7d|14d|30d&sort=velocity|uses|added`, computed from
  stored snapshots, no refetch. UI toggle and sortable columns on `/trackers`.
  EXIT: switching period changes the numbers; sort reorders; both survive reload.

## Phase B — creator tracker (schema)

- [ ] **B1 — schema.** `CreatorTracker` (orgId, platform, handle, displayName,
  avatarUrl, trackedSince) + `CreatorTrackerSnapshot` (followersCount,
  followingCount, postsCount, avgViews, engagementRate, velocityScore,
  recordedAt). `@@unique([orgId, platform, handle])`. Ping the other session first.
  EXIT: `prisma validate` + `generate` clean.

- [ ] **B2 — ingestion.** Extend the A3 sweep. Source order: connected-creator
  official API → IG Business Discovery → YouTube Data API → TikTok direct parse →
  no data. Never a stub.
  EXIT: a tracked handle on each of the three platforms produces a snapshot or an
  explicit no-data reason.

- [ ] **B3 — `/api/trackers/creators`** GET/POST + `[id]` DELETE, orgId-scoped,
  another org's id returns 404. Reuses the A1 metrics module unchanged.
  EXIT: cross-tenant test returns 404, not data.

- [ ] **B4 — UI.** One `/trackers` route, Audios | Creators tabs, one New Tracker
  entry point with a type switch. Loading, empty and error states on both tabs.
  EXIT: both tabs drive end to end in a browser.

## Phase C — honesty pass

- [ ] **C1** Every number carries provenance and a real "last updated". A tracker
  that has never ingested says so instead of rendering a seeded-looking zero.
- [ ] **C2** Remove or clearly mark the seeded sound rows so a demo box cannot be
  mistaken for a working pipeline.

---

## Risks

- **Egress.** TikTok is DNS-sinkholed from Indian ISPs, so A2/A3 cannot be verified
  from a local sweep at all. Verification happens on a deployed function in `iad1`.
  This is the same constraint that blocks the post fetcher, not a new one.
- **Sound-page shape.** Parsing a page we do not control; A2 must degrade to `null`
  rather than write a wrong number. A wrong uses-count is worse than no count,
  because this is the number a label makes signing decisions on.
- **Scope.** §8 rules out replicating CC's scraper. This plan reuses fetchers that
  already exist and adds no new scraping surface beyond one sound page parse.
