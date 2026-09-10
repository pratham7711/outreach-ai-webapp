# Identity-owned connections — expand step, verified against a real Postgres

**Date:** 2026-09-09 · **Branch:** `feat/creator-identity-connections` · **Base:** HEAD `f58efa1`

Everything below was **run and observed**, not inferred from the statement list. The string
assertions in `__tests__/unit/lib/identitySchemaDdl.test.ts` prove the SQL is *shaped* right;
only this proves it *works*.

## Target

A throwaway `postgres:16` container, not Neon. `DATABASE_URL` on this machine points at
`ep-green-shadow-aub0yhjc` (the `e2e-tests` branch of `outreach-prod`) and writes to it are
denied by policy; production is `billowing-frog` and `migrate deploy` must never be aimed at it.

The base schema was `git show HEAD:prisma/schema.prisma` pushed with `prisma db push`, so the
migration ran against the shape production actually has, not against the post-change schema.

## Result

| Step | Outcome |
|---|---|
| Apply #1 from the pre-change schema | **OK.** 5 columns added, all `is_nullable=YES`; 4 indexes created; both FKs created **and validated** (`convalidated=t`) |
| Apply #2, unchanged file | **OK.** `NOTICE ... skipping` on all 9 column/index statements, no error. The `DO $$ … EXCEPTION WHEN duplicate_object` guard swallowed both FK re-adds as designed |
| State after #1 vs after #2 | Identical |
| Revert (drop the 4 + 1 columns, 4 indexes, 2 FKs) | **OK.** Probe returns 0 rows |
| Re-apply | **OK.** State md5 `5b52992263…` — byte-identical to after #1 |
| Legacy key `CreatorSocialAccount_creatorId_platform_platformUserId_key` | Still present after every step |

`confdeltype = n` on both new FKs, i.e. **ON DELETE SET NULL**, as intended.

## Behavioural checks, with real rows

| Case | Expected | Observed |
|---|---|---|
| Same identity + same platform account under a **different** org roster row | Rejected — the legacy key cannot see this, so only the new key can catch it | **Rejected by `CreatorSocialAccount_creatorUserId_platform_platformUserId_key`** by name |
| Same identity, a **second** account on the same platform (different `platformUserId`) | Accepted | Accepted — two TikToks for one person |
| Two different orgs rostering the same person, legacy rows with `creatorUserId` NULL | Accepted — NULLS DISTINCT must keep legacy behaviour intact | Accepted |
| **Hard-delete the `CreatorUser`** | Credential rows survive with `creatorUserId` NULL | **4 of 4 rows survived**, `creatorUserId` NULL, `accessToken` and `tokenAad` untouched. Both roster rows survived too |

That last row is the reason the FKs are `SET NULL` and not `CASCADE`. Under `CASCADE` the two
identity-owned rows would have been destroyed, leaving the OAuth grants live at TikTok, Meta and
Google with nothing left that could revoke them — and the disconnect route already swallows a
failed decrypt and deletes the row anyway, so that failure would have been silent.

## First attempt was wrong, and how

The first duplicate-insert test used the same `creatorId` for both rows, so the **legacy** key
rejected it and the new key was never exercised. A rejection is not evidence that the intended
constraint did the rejecting. Re-run with a second roster row in a second org, which is the only
shape the legacy key is blind to.

A second run was invalid for a different reason: the psql command was held in a shell variable
and never executed, so two "ACCEPTED" lines were reported for statements that never ran. Both
runs are recorded here because a passing result whose mechanism was not checked is the failure
mode this document exists to prevent.

## Not yet verified

- **Nothing has run against Neon.** Both the `e2e-tests` branch and production are untouched.
- **No `CONCURRENTLY` decision.** It depends on `accountRows`, readable only from inside prod via
  `GET /api/admin/migrate-account-identity`. On this empty container all 13 statements ran in
  well under a second, which says nothing about a populated table.
- **The reverse SQL above is not in the repo.** It exists only in the scratchpad script used for
  this run. Before the re-encryption pass runs it has to become a real, tested admin route —
  without it that pass is irreversible in practice whatever the schema permits.
- **This check is manual.** It belongs in CI, whose workflow already stands up a throwaway
  `postgres:16` for exactly this purpose.
