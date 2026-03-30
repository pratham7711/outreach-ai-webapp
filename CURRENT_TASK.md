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
- Added shared hybrid runtime policy resolver:
  - `lib/dashboardPolicy.ts`
  - entitlement gating first, `uiConfig.nav` filtering second
  - hard-required settings/admin routes always visible
- Integrated hybrid policy into dashboard shell:
  - `app/(dashboard)/layout.tsx` now resolves policy and passes allowed nav routes to sidebar
  - `components/NewSidebar.tsx` now filters from policy output instead of local gating rules
- Added/updated hybrid nav validation:
  - `__tests__/unit/lib/dashboardPolicy.test.ts`
  - `e2e/navigation.spec.ts` hardened for org-specific nav configuration
- Gated remaining org-level content APIs by canonical entitlements:
  - `GET/POST /api/reports`
  - `GET/PATCH/DELETE /api/reports/[id]`
  - `GET/POST /api/media-kits`
  - new `DELETE /api/media-kits/[id]`
- Added lean route coverage for reports/media kits and the new delete route
- Replaced dashboard widget config read with canonical entitlement-backed `uiConfig` access
- Fixed `/settings` server-component warning by removing inline server event handlers
- Centralized canonical org feature-key mapping in shared constants (`lib/featureKeys.ts`)
- Refactored entitlement gates to consume shared feature constants across:
  - dashboard policy
  - audit log routes
  - reports routes
  - media-kits routes
  - audit logging writer helper
- Verified no behavior change while reducing gate-key drift risk across API/page/sidebar layers
- Completed final org-level UI entitlement residual sweep:
  - `/audit-log` page now uses `hasOrgFeature(..., AUDIT_LOG_FEATURE)`
  - `/settings/billing` audit-toggle initial state now uses canonical entitlement helper/constants
  - removed direct `entitlements.featureMap.audit_log` reads from dashboard pages

---

## Next:
**Document source-of-truth boundaries and continue org-level entitlement cleanup (non-client-plan)**

### Exact steps:
1. Decide and document whether `lib/orgConfig.ts` remains a standalone accessor or is treated as entitlements-backed legacy helper.
2. Sweep remaining non-client-plan org capability checks for helper/constants conformance.
3. Keep client-level `Plan` behavior untouched.
4. Add lean regression coverage only where behavior changes.
5. Keep `lib/dashboardPolicy.ts` as source of truth for hybrid nav gating.

## Context Files:
- `lib/entitlements.ts`
- `lib/featureKeys.ts`
- `lib/dashboardPolicy.ts`
- `app/api/settings/audit-log/route.ts`
- `app/api/audit-logs/route.ts`
- `app/(dashboard)/layout.tsx`
- `components/NewSidebar.tsx`
- `app/(dashboard)/dashboard/page.tsx`

## Blocker:
None

## Test:
Run:
- `npx jest --config jest.integration.config.js --runInBand __tests__/integration/reports.test.ts __tests__/integration/media-kits.test.ts __tests__/integration/auditLogs.test.ts __tests__/integration/auditLogSettings.test.ts`
- `npm run build`
- `PORT=3009 npx playwright test --config=playwright.config.ts`

Manual smoke:
- Visit `/reports` and `/media-kits` to ensure feature-gated actions are hidden when disabled
- Visit `/settings` and confirm the billing card still loads

---

## Testing Policy (updated 2026-03-30)
**Lean tests only per feature:** 401 + 403 + happy path. No 8-case suites mid-session.
Full test hardening is a dedicated later sprint.
"Done" = feature works in browser + 3 lean tests pass + committed.
