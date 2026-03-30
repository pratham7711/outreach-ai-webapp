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
- Added org-level audit toggle:
  - `GET/PATCH /api/settings/audit-log`
  - persisted in `OrgPlanConfig.features.audit_log`
  - toggle UI card on Billing page using `@pratham7711/ui` `Toggle`
- Enforced toggle behavior:
  - `logAudit` skips writes when `audit_log` is disabled
  - `GET /api/audit-logs` returns `403` when `audit_log` is disabled
  - `/audit-log` page renders a disabled state with link to `/settings/billing`
- Added coverage:
  - `__tests__/integration/auditLogs.test.ts`
  - `__tests__/integration/auditLogSettings.test.ts`
  - `e2e/audit-log.spec.ts`
- Patched live dashboard sidebar (`components/NewSidebar.tsx`) to expose `Settings`, `Audit Log`, and `Billing`

---

## Next:
**Replace remaining direct plan consumers with canonical entitlement helpers**

### Exact steps:
1. Inventory all remaining reads of `Organization.plan` and `lib/plans.ts` in app + API routes.
2. Migrate org-level feature/limit checks to `getOrgEntitlements(orgId)` and `featureMap`.
3. Keep client-level `Plan` behavior isolated (only client feature access pages/use-cases).
4. Add lean regression tests (`401`, `403`, happy path`) only for routes changed by migration.
5. Confirm sidebar/nav gating rules should come from `uiConfig.nav` and/or entitlement feature flags, then codify in one place.

## Context Files:
- `lib/entitlements.ts`
- `app/api/settings/audit-log/route.ts`
- `app/api/audit-logs/route.ts`
- `app/(dashboard)/settings/billing/AuditLogToggleCard.tsx`
- `app/(dashboard)/audit-log/page.tsx`
- `components/NewSidebar.tsx`

## Blocker:
None

## Test:
Run:
- `npx jest --config jest.integration.config.js --runInBand __tests__/integration/auditLogs.test.ts __tests__/integration/auditLogSettings.test.ts`
- `npm run build`
- `PORT=3009 npx playwright test --config=playwright.config.ts`

Manual smoke:
- Visit `/audit-log` and verify filters + pagination load
- Visit `/settings` and open `/settings/billing`

---

## Testing Policy (updated 2026-03-30)
**Lean tests only per feature:** 401 + 403 + happy path. No 8-case suites mid-session.
Full test hardening is a dedicated later sprint.
"Done" = feature works in browser + 3 lean tests pass + committed.
