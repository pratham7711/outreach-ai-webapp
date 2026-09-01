# NEEDS-HELP.md — Decisions only Pratham can make

Rewritten 2026-09-01. Everything previously in this file had either been built
or been answered by shipping something else; the old version described a project
running on SQLite with no email, which had not been true for months. A stale
question is worse than no question — it sends an agent to re-decide settled
things. **If you answer an item here, delete it.**

## Resolved since the last version — do not re-ask

- **Database.** PostgreSQL on Neon. `features` / `featureOverrides` are native
  `Json`. Production is the `production` branch of Neon project
  `billowing-frog-77604601`.
- **Email.** Resend, working. The forgot-password round trip was verified
  end-to-end on production, inbox not spam.
- **Feature enforcement.** Enforced. `DASHBOARD_NAV_RULES` filters the sidebar
  per org, and `lib/rbac.ts` (`resolvePermissions`, `hasPermission`) is used in
  11 places.
- **Audit trail.** Written. `lib/audit.ts` has 51 call sites and production
  `AuditLog` rows exist for invite create/accept/delete.
- **Confirmation modals.** `ConfirmProvider` is mounted in the dashboard layout;
  no `window.confirm` remains.
- **Campaign and creator limits.** Answered 2026-09-01: there are none, on any
  tier. Trackers are the only thing a plan limits (plus seats, which the invite
  endpoint enforces). `getOrgEntitlements` deliberately ignores the stored
  `OrgPlanConfig.maxCampaigns`/`maxCreators` columns rather than reading them.
  Signup creates a `planConfig` row with only `planName` set, so the schema
  defaults land (10 campaigns, 100 creators) and those were what a new tenant
  actually saw — the `PLANS.starter` figures of 20/500 only applied to an org
  with no row, which signup never produces. Honouring the columns would
  reinstate a cap nobody chose.
- **TikTok post metrics.** They sync, and always did — a keyless read of the
  video page, preferring `statsV2`, so the figures are exact. The old worry that
  TikTok counts were frozen came from `lib/capabilities.ts` gating them on the
  optional SocialKit key; that is fixed. No key to buy.
- **Google OAuth.** Not configured, and not missed — credentials login is the
  only provider and signup works. Reopen it only if someone asks for SSO.

## Genuinely open

### 1. `admin@demo.com` / `admin123` on the public domain
The demo org is the designated testing tenant, so its *data* is disposable, but
the credential is guessable, the account is an OWNER, and it can send invites.
Change the password, or disable the account and keep a private way in? This is
the one item on this list with a security edge, and it wants deciding before the
URL goes to anyone outside the team.

### 2. Plan pricing
`Plan` still has no price field, and no billing is wired. Is this permanently
feature-gating only, or is a billing integration coming? It changes whether
`Plan` needs money on it at all.

### 3. Who may manage plans
`/plans` and `/api/plans` have no role check — any authenticated member of the
org can create and assign plans. `lib/rbac.ts` already has the vocabulary
(`OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`). Should plan management be
OWNER/ADMIN only? Probably yes; it is left open because it is a product rule, not
an oversight to be quietly patched.

### 4. Should a deleted campaign's views still count on the dashboard?

**Half-answered, and inconsistently, which makes deciding it more urgent than
before.** The "Views over time" chart now reads `OrgViewsSnapshot`, and the daily
job that writes those rows (`lib/analytics/orgViewsSnapshot.ts`) *does* filter
`c."deletedAt" IS NULL` — so the chart excludes deleted campaigns. The platform,
per-campaign and per-creator rollups on the same route still do not. So the
chart and the tiles beside it now answer this question two different ways.

Whichever answer wins, it should be applied to all of them; the snapshot job
picked one so that it could write a number at all, not because the question was
settled.

It costs nothing today: soft-deleted campaigns on production hold 0 posts and 0
views, so no number is currently wrong. But the first time someone deletes a
campaign that has delivery on it, the dashboard total and the campaign list will
disagree, and a per-campaign row will appear titled "Unknown campaign" (the
title lookup *does* filter on `deletedAt`).

Both answers are defensible — "deleted means gone from reporting" or "delivery
that happened still happened" — which is why it is here rather than patched.

### 5. Override persistence on plan change
When a client's plan changes, existing per-client `featureOverrides` are
preserved. Should a plan change clear them instead? Carried over from the old
file because it is still true and still undecided.

### 6. Creating the `OrgViewsSnapshot` table on production
The daily views cron and the rewritten chart are written, tested and building
clean, but the table does not exist on production yet, and **the deploy must not
go out before it does** — `/api/dashboard/financials` will 500 on
`relation "OrgViewsSnapshot" does not exist`, which is the whole dashboard.

The change is purely additive; `prisma migrate diff` produced exactly one
`CREATE TABLE`, two indexes and one foreign key, with nothing dropped or
altered. The SQL is at `scratchpad/orgviews.sql`. Applying it needs an explicit
go-ahead because it is DDL against a production database that has no
`_prisma_migrations` table, so `migrate deploy` is not an option and the
statements go in directly.

Order: apply the SQL → seed today's row (`snapshotOrgViews`, or just let the
03:30 UTC cron take the first reading) → deploy.
