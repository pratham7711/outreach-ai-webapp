# Current Task

## Status: IN_PROGRESS

## Task: Feature gating + audit coverage expansion

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
- Gated `GET /api/discovery` behind `creator_discovery` org entitlement (403 when disabled); added `DISCOVERY_FEATURE` to `lib/featureKeys.ts`
- Added featureDisabled EmptyState to `/discovery` page (lock icon + billing CTA, matches reports pattern)
- Added `__tests__/integration/discovery.test.ts` (401 + 403 + 200, 3/3 pass)
- Added `logAudit` loop to `POST /api/payouts/bulk` — one audit entry per successfully updated payout (`action: payout.status_changed`)
- Added `__tests__/integration/payoutAudit.test.ts` (401 + N-payout audit + single-PATCH 401, 3/3 pass)
- Confirmed `app/(dashboard)/clients/[id]/page.tsx` already fully implemented — no changes needed
- Documented `lib/orgConfig.ts` source-of-truth boundary (standalone raw uiConfig accessor, not entitlements-backed)
- Aligned `GET /api/audit-logs` entitlement check to `hasOrgFeature()` helper (consistent with all other access gates)
- Updated `auditLogs.test.ts` mock to spread `jest.requireActual` so `hasOrgFeature` is available alongside mocked `getOrgEntitlements`
- Completed final org-level UI entitlement residual sweep:
  - `/audit-log` page now uses `hasOrgFeature(..., AUDIT_LOG_FEATURE)`
  - `/settings/billing` audit-toggle initial state now uses canonical entitlement helper/constants
  - removed direct `entitlements.featureMap.audit_log` reads from dashboard pages

---

## Next:
**Feature gating is consistent across discovery, reports, media-kits, audit-log. Payout bulk now audited.**

### Options for next session:
1. Discovery filter/search enhancements (genre, follower range, engagement rate filters)
2. Payout workflow improvements (balance enforcement, per-creator caps, multi-currency gate)
3. Client-plan feature flag UX (locked/disabled states for client-scoped features)
4. Test hardening sprint (full suite for all routes)

## Context Files:
- `lib/featureKeys.ts` — all canonical feature key constants
- `lib/entitlements.ts` — org capability source (hasOrgFeature pattern)
- `app/api/discovery/route.ts` — reference for new 403 gate pattern

## Blocker:
None

## Test:
Run:
- `npx jest --config jest.integration.config.js --runInBand __tests__/integration/discovery.test.ts __tests__/integration/payoutAudit.test.ts __tests__/integration/auditLogs.test.ts __tests__/integration/auditLogSettings.test.ts`
- `npm run build`

---

## Testing Policy (updated 2026-03-30)
**Lean tests only per feature:** 401 + 403 + happy path. No 8-case suites mid-session.
Full test hardening is a dedicated later sprint.
"Done" = feature works in browser + 3 lean tests pass + committed.
