# Current Task

## Status: Sprint 0 · Task 1 — CODE COMPLETE (all 3 units); only ops remains (blocked on env key)

## Task: Sprint 0 · Task 1 — AES-256-GCM token crypto (P0 hard blocker)

**Why first:** `CreatorSocialAccount` OAuth tokens were stored PLAINTEXT while the schema comment falsely claimed AES. No real provider credential ships until this lands. #1 P0 in `docs/BUILD_TRACKER.md`.

## Done — code complete + verified:
- **Unit 1 (committed `bc016a2`):** `webapp/lib/crypto/encrypt.ts` — AES-256-GCM `encrypt`/`decrypt`/`isEncrypted` (12-byte IV, 16-byte tag verified + length-validated, key from `TOKEN_ENCRYPTION_KEY`, AAD = version + optional `context`). 14 unit tests; passed a Loop-5 adversarial review.
- **Unit 2 (verified 16/16; lives in your working-tree WIP batch — NOT separately committed):** wired `encrypt()` into `POST /api/creators/[id]/social-accounts` (accessToken + refreshToken encrypted before `create`, AAD = `orgId` → cross-tenant-safe); fixed the false schema comment (`prisma/schema.prisma:445-446`). These edits are interleaved with your ~40-file WIP in `route.ts` + `schema.prisma` — **commit them with your batch**.
- **Unit 3 (committed `958c284`):** `lib/crypto/token-backfill.ts` (`planReencrypt` + `findPlaintext`, pure, idempotent, AAD = orgId) + `scripts/backfill-encrypt-tokens.ts` `[--dry-run]` + `scripts/assert-no-plaintext-tokens.ts` (CI guard). 6 unit tests green.

## Remaining — operational only (BLOCKED on the env key):
1. Provision `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) in prod + staging secrets.
2. Run the backfill: `npx tsx scripts/backfill-encrypt-tokens.ts --dry-run`, then again without `--dry-run`.
3. Wire `npx tsx scripts/assert-no-plaintext-tokens.ts` into CI as a gate.
Once 1–3 land, flip the WS0 / Sprint-0 task to `[x]` in `docs/BUILD_TRACKER.md`.

## Deferred (tracked, not bugs):
- Stop-hook `tsc` gate → baseline-diff ("no NEW errors"; repo has 170 pre-existing `tsc` errors).
- Key rotation / keyring (the `v1` format tag reserves the path).

## Next build task after this:
WS0 item 2 — external intelligence catalog migration (CreatorProfile / AudienceProfile / ContentItem / ContentEmbedding / OrgMetricRollup / AuthenticitySnapshot) + pgvector. See `docs/BUILD_TRACKER.md`.
