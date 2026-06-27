# Current Task

## Status: IN PROGRESS — Sprint 0 · Task 1 — Unit 1 of 3 DONE (verified + reviewed)

## Task: Sprint 0 · Task 1 — AES-256-GCM token crypto (P0 hard blocker)

**Why first:** `CreatorSocialAccount` OAuth tokens are stored PLAINTEXT while the schema comment (`prisma/schema.prisma:445`) falsely claims AES. No real provider credential may be wired until this lands. #1 P0 in `docs/BUILD_TRACKER.md`.

## Completed — Unit 1 (the crypto utility):
- `webapp/lib/crypto/encrypt.ts` — AES-256-GCM `encrypt(plaintext, context?)` / `decrypt(payload, context?)` / `isEncrypted(value)`. 12-byte random IV per call; 16-byte auth tag produced + verified (+ length-validated, so no truncated-tag forgery); 32-byte key from `process.env.TOKEN_ENCRYPTION_KEY` (lazy load, base64, all-zero rejected); versioned `enc:v1:iv:tag:ct` format; AAD bound to the version with an optional `context` for per-row/orgId binding in Unit 2.
- `webapp/__tests__/unit/lib/crypto/encrypt.test.ts` — 14 tests: round-trip (ascii/unicode/empty/long), random-IV, tamper, wrong-key, wrong-length IV/tag, IV/tag bit-flip, AAD-context mismatch, non-string input, bad/missing/all-zero key.
- **Evidence:** `npm run test:unit` → 14/14 green; `tsc --noEmit` → 0 errors in these files. Loop-5 adversarial review passed (GCM core sound; the two blockers — IV/tag length validation and AAD binding — fixed).

## Next — Unit 2 (wiring; unblocked; run with `/build-loop`):
Wire `encrypt`/`decrypt` into EVERY read/write of `CreatorSocialAccount.accessToken` / `refreshToken`, passing the account id (or orgId) as the AAD `context`. Encrypt `refreshToken` only when non-null. Fix the false comment at `prisma/schema.prisma:445`. Exit: touched-route tests + `tsc` clean on touched files.

## Then — Unit 3 (BLOCKED on env key):
One-shot backfill to encrypt existing plaintext rows + a CI assertion that fails if any persisted token is plaintext (`isEncrypted` over the column).
**Blocker:** provision `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`) into prod/staging secrets before the backfill runs or any real token is stored.

## Deferred (tracked in BUILD_TRACKER WS0 — not bugs):
- Make the Stop-hook `tsc` gate a baseline-diff ("no NEW errors") — the repo has 170 pre-existing `tsc` errors, so a "zero errors" gate would always block. Or add a tsc-cleanup task.
- Key rotation / keyring (the `v1` tag reserves the path); strict base64 re-encode validation.

## Test (exit criteria — show evidence, per `docs/LOOPS.md`):
Unit 1 ✅. Unit 2/3 exit: round-trip holds end-to-end through Prisma; `tsc` clean on touched files; no plaintext token persists (CI check). Paste output, don't assert.
