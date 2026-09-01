/**
 * Row-level campaign visibility.
 *
 * The reference offers this per user as "View All Campaigns" vs "View Assigned
 * Only". We had roles but no row scope, so a MEMBER saw every campaign in the
 * organisation — fine for a five-person agency, wrong for one running work for
 * competing clients out of the same workspace.
 *
 * The whole thing is one function returning a Prisma `where` fragment, for a
 * reason: 59 files read campaigns, and an access rule expressed 59 times is an
 * access rule with 59 chances to be spelled differently. Anything that needs
 * scoping composes this instead of reimplementing it.
 *
 * IMPORTANT, and stated here because it is the honest limit of the current
 * change: this is applied to the campaign list and campaign detail — the two
 * paths that decide whether a campaign is *reachable*. Aggregate surfaces
 * (analytics, calendar, deadlines, dashboard counts) still compute across the
 * whole org, so a scoped user can still infer that other campaigns exist from
 * a total. Closing that is a deliberate sweep, not a side effect of this file,
 * and it should be done before this is described to anyone as isolation.
 */

export type CampaignScope = "ALL" | "ASSIGNED";

export type ScopeSubject = {
  userId: string;
  role: string;
  campaignScope: CampaignScope;
};

/**
 * Roles that always see everything, whatever their scope says.
 *
 * An OWNER or ADMIN scoped to "assigned only" would be locked out of campaigns
 * they are responsible for and, worse, out of the screens where scope itself is
 * administered — the same trap as suspending an org with no platform admin.
 */
const ALWAYS_FULL_VIEW = new Set(["OWNER", "ADMIN"]);

export function seesAllCampaigns(subject: ScopeSubject): boolean {
  return subject.campaignScope !== "ASSIGNED" || ALWAYS_FULL_VIEW.has(subject.role);
}

/**
 * A `where` fragment to AND into a campaign query.
 *
 * Returns `{}` for unscoped users so callers can spread it unconditionally and
 * the common path costs nothing.
 *
 * "Assigned" means on the team or the creator of it. Excluding the creator
 * would let someone make a campaign and immediately lose sight of it, which
 * reads as data loss rather than as a permission.
 */
export function campaignScopeWhere(subject: ScopeSubject): Record<string, unknown> {
  if (seesAllCampaigns(subject)) return {};
  return {
    OR: [
      { teamMembers: { some: { userId: subject.userId } } },
      { createdById: subject.userId },
    ],
  };
}

/** Reads a session user into the shape this module wants, defaulting safely. */
export function scopeSubjectFromSession(user: unknown): ScopeSubject | null {
  const u = user as Record<string, unknown> | null;
  const userId = typeof u?.id === "string" ? u.id : null;
  if (!userId) return null;
  return {
    userId,
    role: typeof u?.role === "string" ? u.role : "VIEWER",
    // Anything unrecognised falls to ALL rather than ASSIGNED: an unreadable
    // value should not silently hide a user's own work from them.
    campaignScope: u?.campaignScope === "ASSIGNED" ? "ASSIGNED" : "ALL",
  };
}

/**
 * The same rule, for API routes that authenticate through `authenticateRequest`.
 *
 * A machine caller (an org API key) has no user and no team, so it is not
 * scoped — the key is an organisation credential, and narrowing it to "campaigns
 * this key is a member of" would mean none at all.
 */
export function campaignScopeWhereFor(auth: {
  userId: string | null;
  role: string | null;
  campaignScope: "ALL" | "ASSIGNED" | null;
}): Record<string, unknown> {
  if (!auth.userId || auth.campaignScope !== "ASSIGNED") return {};
  return campaignScopeWhere({
    userId: auth.userId,
    role: auth.role ?? "VIEWER",
    campaignScope: "ASSIGNED",
  });
}
