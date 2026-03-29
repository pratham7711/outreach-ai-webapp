# Current Task

## Status: DONE

## Task: Phase 0 — Foundation Setup — Step 1: Switch to PostgreSQL (Neon)

---

## Completed:
- Prisma schema set to PostgreSQL provider with all foundation models (OrgPlanConfig, UserInvite, ApiKey, CreatorSocialAccount, CampaignType enum)
- Migration `foundation_postgresql_all_models` created and applied to Neon
- `lib/db.ts` uses PrismaPg adapter (fixed PrismaPostgres → PrismaPg)
- `prisma.config.ts` updated with seed command for Prisma 7
- Seed script updated: adds OrgPlanConfig (pro plan) + uiConfig on demo org
- Fixed contactInfo fields in seed (String, not Object)
- Fixed Prisma nullable Json type errors in client feature/plan routes (use Prisma.DbNull)
- Created `.env.example` (commit-safe template)
- Deleted `prisma/dev.db` (SQLite artifact)
- Integration test: `__tests__/integration/orgConfig.test.ts` (6 tests passing)
- Build passes (`npm run build`)

---

## Next:
**Phase 0 — Step 2: Set up remaining foundation** (per the full implementation plan)

## Context Files:
- webapp/prisma/schema.prisma
- webapp/lib/db.ts
- webapp/prisma/seed.ts

## Blocker:
None

## Test:
`PORT=3009 npm run dev` loads dashboard without errors + `npx jest --config jest.integration.config.js __tests__/integration/orgConfig.test.ts` passes
