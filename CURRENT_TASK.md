# Current Task

## Status: IN_PROGRESS

## Task: Entitlement cleanup and plan-consumer migration

---

## Completed:
- Added `GET /api/audit-logs` with auth/permission checks, org scoping, filters, and pagination
- Added audit log dashboard at `/audit-log` (server page + interactive filter/pagination client)
- Added billing/settings surfaces:
  - `/settings` index page with Team / API Keys / Billing cards
  - `/settings/billing` page backed by canonical `getOrgEntitlements(orgId)`
- Added Playwright coverage for audit log page (`e2e/audit-log.spec.ts`)
- Added lean integration coverage for `GET /api/audit-logs` (`401`, `403`, happy path)
- Patched live dashboard sidebar (`components/NewSidebar.tsx`) to expose `Settings`, `Audit Log`, and `Billing`

---

## Next:
**Replace remaining direct plan consumers with canonical entitlement helpers**

### Exact steps:
1. Inventory all reads of `Organization.plan` and `lib/plans.ts` in app + API routes
2. Swap org-level gating to `getOrgEntitlements(orgId)` / `featureMap`
3. Keep client-specific `Plan` model behavior isolated (do not break client plan pages)
4. Add focused regression tests where behavior changes (lean policy)
5. Document final decision boundary: org entitlements vs client plans

## Context Files:
- `lib/entitlements.ts`
- `app/api/audit-logs/route.ts`
- `app/(dashboard)/audit-log/page.tsx`
- `components/NewSidebar.tsx`

## Blocker:
None

## Test:
Run:
- `npx jest --config jest.integration.config.js --runInBand __tests__/integration/auditLogs.test.ts`
- `npm run build`
- `npx playwright test --config=playwright.config.ts`

Manual smoke:
- Visit `/audit-log` and verify filters + pagination load
- Visit `/settings` and open `/settings/billing`

---

## Testing Policy (updated 2026-03-30)
**Lean tests only per feature:** 401 + 403 + happy path. No 8-case suites mid-session.
Full test hardening is a dedicated later sprint.
"Done" = feature works in browser + 3 lean tests pass + committed.
