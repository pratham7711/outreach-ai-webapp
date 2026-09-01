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

### 2. Should `maxCampaigns` and `maxCreators` be enforced, or stopped being shown?
Today they are reported by `/api/tenant/config` and rendered in the UI, and
nothing refuses the eleventh campaign. Only `maxUsers` and `maxTrackers` are
actually checked. Enforcing them as they stand would cap a fresh signup — LKay
Media included — at 10 campaigns and 100 creators, which is below what an agency
needs on day one. So the choice is: raise the starter numbers *and* enforce, or
stop displaying a limit that does not exist. Not a call to make silently either
way.

### 3. Plan pricing
`Plan` still has no price field, and no billing is wired. Is this permanently
feature-gating only, or is a billing integration coming? It changes whether
`Plan` needs money on it at all.

### 4. Who may manage plans
`/plans` and `/api/plans` have no role check — any authenticated member of the
org can create and assign plans. `lib/rbac.ts` already has the vocabulary
(`OWNER`, `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`). Should plan management be
OWNER/ADMIN only? Probably yes; it is left open because it is a product rule, not
an oversight to be quietly patched.

### 5. Override persistence on plan change
When a client's plan changes, existing per-client `featureOverrides` are
preserved. Should a plan change clear them instead? Carried over from the old
file because it is still true and still undecided.
