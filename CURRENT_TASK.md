# Current Task

## Status: Sprint 0 · Task 1 — DONE, including the ops steps. Nothing is blocked.

Last verified 2026-09-01 against production.

## What was blocking, and is not any more

**Sprint 0 · Task 1 — AES-256-GCM token crypto (was the #1 P0).** All three code
units landed (`bc016a2`, `958c284`, plus the route wiring), and the three
"operational only, BLOCKED on the env key" steps this file used to list are all
complete:

1. `TOKEN_ENCRYPTION_KEY` is provisioned in Vercel production.
2. The backfill has run. `npx tsx scripts/assert-no-plaintext-tokens.ts` against
   the production database answers *"OK: all 2 social-account token(s) are
   encrypted at rest."*
3. The guard is wired into CI twice, in `.github/workflows/ci.yml` — as
   `prod-token-audit` (`workflow_dispatch` only, because it is the one job that
   reads production) and inside `e2e-prod` against a throwaway Postgres, which
   runs on every commit.

The file claimed for weeks that this was blocked. It was not, and an agent
reading it started by re-doing finished work. If you find a claim here you
cannot reproduce with a command, delete it rather than working around it.

## Where the product actually stands

Production is `campaign.madeboring.com`, and it is handover-ready: signup →
onboarding → campaigns → creators → posts → analytics → payouts all work
end-to-end, tenant isolation is verified live, and the forgot-password email
round-trip lands in an inbox. Test state: unit 126 suites / 1511 tests green,
integration 81 suites / 915 tests green, `tsc --noEmit` clean, `npm run build`
clean.

## Known gaps, in the order they will bite

1. **`admin@demo.com` / `admin123` is a live OWNER login on the public domain.**
   The demo org is the designated testing tenant, so its data does not matter,
   but the credential is guessable and the account can invite. Change the
   password or disable the account before anyone outside the team has the URL.
2. ~~`maxCampaigns` and `maxCreators` reported but never enforced.~~
   **Resolved 2026-09-01: there is no limit on campaigns or creators, on any
   tier.** Trackers are the only thing a plan limits, plus seats, which the
   invite endpoint does enforce. `PLANS` carries Infinity for both on every
   tier, `getOrgEntitlements` returns Infinity unconditionally, and it
   deliberately does **not** read `OrgPlanConfig.maxCampaigns`/`maxCreators` —
   those columns default to 10/100 in the schema, so any org with a plan
   configured carries a small number nobody chose (demo holds 50/500 that way).
   The columns stay, unread, because production was built with `db push` and has
   no migrations table. Billing now shows Tracked sounds and Max users as real
   numbers, and Campaigns and Creators as "Unlimited".

3. **TikTok post metrics DO auto-sync — the capability report used to deny it.**
   Corrected 2026-09-01. `fetchTikTokMetrics` tries a keyless read of the video
   page's rehydration blob first, and it prefers `statsV2`, so the counts are
   exact. Production evidence: 422 cron-written TikTok post snapshots with
   values genuinely moving (336 → 952 views on one post), hourly at `:01`, with
   no `SOCIALKIT_API_KEY` set anywhere. SocialKit is only the third rung of that
   ladder; buying a key buys nothing that is missing.
   What *was* broken is that `lib/capabilities.ts` keyed TikTok's metric status
   off that optional key, so the onboarding step read "Instagram and YouTube
   counts refresh on their own" — naming everything except the platform holding
   15,324 of the 18,690 posts. Fixed; TikTok's metric collector needs no
   credential and the report now says so.
   Still walled from Vercel egress, and unrelated to the above: TikTok
   **profile** pages (read through a Sandbox curl) and the **video grid**
   (`item_list`, which defeats headless Chromium even in a Sandbox).

4. **`docs/BUILD_TRACKER.md` does not exist on this machine.** The old
   references to "#1 P0 in `docs/BUILD_TRACKER.md`" and "WS0 item 2" point at a
   file that was never copied off the previous laptop, along with `AGENTS.md`
   and `AGENTS_QUICKSTART.md`. Treat the sprint numbering in old commits as
   history, not as a live plan.

## Deferred, tracked, not bugs

- Key rotation / keyring — the `v1` format tag reserves the path.
- Stop-hook `tsc` gate as a baseline diff. Moot for now: the baseline is zero.
