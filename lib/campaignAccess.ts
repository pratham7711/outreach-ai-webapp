import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { campaignScopeWhereFor } from "@/lib/campaignScope";

/**
 * Row scope ("View Assigned Only") enforced on routes that take a campaign id.
 *
 * lib/campaignScope.ts states the rule; this is the server half that applies
 * it to a request. Before it, the scope was applied to the campaign list page
 * and to five API routes, so a member scoped to "assigned only" could not see
 * an unassigned campaign in the list but could read and write everything under
 * /api/campaigns/<id>/... -- its posts, invites, negotiations, payouts, share
 * link -- by typing the id. Scope that only hides a row from a list is a filter,
 * not access control.
 *
 * Two properties that every caller relies on:
 *
 *  - FREE FOR EVERYONE UNSCOPED. campaignScopeWhereFor returns {} for OWNER,
 *    ADMIN, anyone on "all campaigns" and API keys, and then no query runs at
 *    all. The org check stays in the route, where it already was.
 *  - 404, NOT 403. A campaign outside your scope answers exactly like one that
 *    does not exist, so the id space cannot be probed for which campaigns the
 *    agency is running for other clients.
 *
 * Deleted campaigns are not filtered here: whether a route may touch a deleted
 * campaign is that route's own decision, and it still makes it.
 */
export type CampaignAccessSubject = {
  orgId: string;
  userId: string | null;
  role: string | null;
  campaignScope: "ALL" | "ASSIGNED" | null;
};

/** A NextAuth session user, read into the subject shape. Null without an org. */
export function accessSubjectFromSession(user: unknown): CampaignAccessSubject | null {
  const u = user as Record<string, unknown> | null | undefined;
  const orgId = typeof u?.orgId === "string" ? u.orgId : null;
  if (!orgId) return null;
  return {
    orgId,
    userId: typeof u?.id === "string" ? u.id : null,
    role: typeof u?.role === "string" ? u.role : null,
    // Same default as scopeSubjectFromSession: unreadable reads as ALL, so a
    // malformed token never hides a user's own work from them.
    campaignScope: u?.campaignScope === "ASSIGNED" ? "ASSIGNED" : "ALL",
  };
}

const notFound = () => NextResponse.json({ error: "Campaign not found" }, { status: 404 });

/**
 * The 404 to return when `campaignId` is outside the caller's row scope, or
 * null when the caller may reach it (or is unscoped, at no cost).
 */
export async function campaignScopeDenial(
  subject: CampaignAccessSubject,
  campaignId: string
): Promise<NextResponse | null> {
  const scope = campaignScopeWhereFor(subject);
  if (Object.keys(scope).length === 0) return null;
  const visible = await db.campaign.findFirst({
    where: { id: campaignId, orgId: subject.orgId, ...scope },
    select: { id: true },
  });
  return visible ? null : notFound();
}

/** The same check for routes that authenticate through auth(). */
export async function sessionCampaignScopeDenial(
  user: unknown,
  campaignId: string
): Promise<NextResponse | null> {
  const subject = accessSubjectFromSession(user);
  if (!subject) return notFound();
  return campaignScopeDenial(subject, campaignId);
}
