# Current Task

## Status: DONE

## Task: Discovery add-to-list flow + entitlement/audit foundation

---

## Completed:
- Discovery page already had live search/filter API; wired the missing "Add to list" modal and POST flow
- Added org validation to `POST /api/lists/[id]/creators`
- Fixed security: `GET /api/creators` now filters by `orgId`
- Added shared org entitlement resolver and switched tenant config endpoint to read `OrgPlanConfig` first
- Added audit logging payload support and wired audit writes into major mutating admin routes
- Added lean integration coverage for `POST /api/lists/[id]/creators`

---

## Next:
**Billing / audit-log / entitlement cleanup**

### Exact steps:
1. Add `/api/audit-logs` and `/audit-log` dashboard UI
2. Build billing/settings page that reads canonical org entitlements and limits
3. Replace remaining direct `Organization.plan`/`lib/plans.ts` consumers with shared entitlement helpers
4. Decide whether client-level `Plan` stays a separate concept or folds into org entitlements

## Context Files:
- `lib/entitlements.ts`
- `lib/audit.ts`
- `app/api/tenant/config/route.ts`
- `app/(dashboard)/discovery/page.tsx`

## Blocker:
None

## Test:
Visit `/discovery` → search for a creator by name → filter by platform → add to a list.
Visit `/settings/team` and `/settings/api-keys` → create/delete flows should now also emit audit writes.

---

## Testing Policy (updated 2026-03-30)
**Lean tests only per feature:** 401 + 403 + happy path. No 8-case suites mid-session.
Full test hardening is a dedicated later sprint.
"Done" = feature works in browser + 3 lean tests pass + committed.
