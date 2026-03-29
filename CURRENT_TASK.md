# Current Task

## Status: DONE

## Task: Post-PostgreSQL Feature Buildout (Agent Pipeline)

---

## Completed:
- **Campaign type selector** — 4 types (Budget, Views, Community, Invite) in create modal, API, badges on cards/detail (9 tests)
- **PROGRESS.md updated** — reflects PostgreSQL/Neon state, removed SQLite references
- **Integration tests for detail routes** — creators/[id], activations/[id], payouts/[id], lists/[id] (33 tests)
- **Team invites** — API routes (create/list/delete/accept), team management UI at /settings/team (16 tests)
- **API key management** — API routes (create/list/revoke), UI at /settings/api-keys, SHA-256 hashed storage (10 tests)
- **SDUI dashboard** — widgets driven by uiConfig.dashboard, sidebar nav filtered by uiConfig.nav, branding from uiConfig.branding (10 tests)
- **Test fixes** — fixed stale mocks in creators.test.ts and lists.test.ts, updated sidebar test
- **Full test suite** — 166 unit + 189 integration = 355 tests passing, build clean

## Commits (this session):
1. `685082e` chore: switch to postgresql, add foundation schema models
2. `f040243` chore: update progress tracker, add integration tests for detail routes
3. `ded719b` feat: add campaign type selector and type-specific config
4. `a220599` feat: API key management — create, list, revoke keys
5. `9881d96` feat: team invite flow — create, send, accept invitations
6. `28b0133` feat: SDUI dashboard driven by org uiConfig
7. `9fb6a00` fix: resolve test failures after feature buildout

---

## Next:
Phase 4 — Feature Completion:
- Wire campaign detail tabs (Creators, Posts, Budget) with real data
- Creator edit form + campaign history on detail page
- Discovery page with search/filter
- Calendar timeline view
- E2E Playwright tests (need running dev server with DB access)

## Context Files:
- webapp/prisma/schema.prisma
- webapp/PROGRESS.md
- webapp/lib/orgConfig.ts

## Blocker:
E2E Playwright tests fail with ECONNREFUSED — Neon DB connection refused in Playwright webserver context. Need to run E2E manually with `PORT=3009 npm run dev` running separately.

## Test:
`npm run build` passes + `npx jest --config jest.config.js` (166 pass) + `npx jest --config jest.integration.config.js` (189 pass)
