# NEEDS-HELP.md — Items Needing Pratham's Input

## Design Decisions

- **Feature flag names**: The current 10 feature flags in `lib/features.ts` (analytics, bulk_export, api_access, etc.) were chosen based on common SaaS patterns. Are these the right features to gate, or should they map to the sidebar nav items (campaigns, creators, payouts, etc.) as the task spec originally suggested?
- **Plan pricing/billing**: Plans currently have no price field. Should we add pricing tiers, or is this purely feature-gating without billing?
- **Override persistence**: When a client's plan changes, existing overrides are preserved. Should plan changes clear all overrides instead?

## External Services Required

- **Production database**: Currently using SQLite (`prisma/dev.db`). Need to choose and configure a production PostgreSQL provider (Neon recommended).
- **OAuth providers**: Google OAuth for login is not yet configured — needs Google Cloud Console OAuth credentials.
- **Email/notifications**: No email service configured for password reset or notifications.

## Feature Access System

- **Role-based access**: Feature access is currently org-wide (any logged-in user can manage plans). Should only OWNER/ADMIN roles be able to access `/admin` and `/plans`?
- **Feature enforcement**: The feature flags exist in the UI but aren't enforced anywhere yet — sidebar items and pages are always accessible. Need Pratham's input on whether to actually hide/disable sidebar items based on the active client's plan.
- **Audit trail**: The `AuditLog` model exists in the schema but isn't being written to when plan/feature changes happen.

## Database Decisions

- **Migration from SQLite to PostgreSQL**: The Prisma schema uses SQLite-specific `String` for JSON fields (features, featureOverrides). When migrating to PostgreSQL, these should become native `Json` type.
- **Seed data in production**: The seed script creates demo data. Need a separate production seed or import scripts for real client data.

## UI/UX Questions

- **Mobile responsiveness**: The feature access dashboard and bulk operations bar are desktop-optimized. Mobile layout not addressed.
- **Confirmation modals**: Bulk operations (assign plan, clear overrides) use browser `confirm()`. Should these use custom styled modals?
- **Real-time updates**: After bulk operations, the page refreshes via `router.refresh()`. This works but could be smoother with optimistic updates.
