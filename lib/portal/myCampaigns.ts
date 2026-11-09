import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import type { CreatorSession } from "@/lib/creator-auth";
import { findCreatorsForHandle } from "@/lib/portal/creatorLookup";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { nextCampaignDate, type CampaignDate } from "@/lib/portal/campaignDates";
import { campaignInvitePath, portalCampaignPath } from "@/lib/portal/invitePath";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";

/**
 * Which campaigns a creator sees in the creator app, and why.
 *
 * Two kinds of roster row can stand behind a portal login:
 *
 *  - IDENTITY rows: Creator.creatorUserId is this login. Only the person it
 *    names can set it -- their own marketplace join creates the row with it
 *    (lib/marketplace/join.ts), and accepting an agency's per-creator invite
 *    link writes it (lib/portal/campaignInvite.ts). These rows show every
 *    campaign they are on, including an agency's private ones.
 *  - HANDLE rows: a roster row whose handle matches the portal username.
 *    Registration checks handles only against other portal accounts, so anyone
 *    can sign up as "bigcreator" and match every agency's row of that name. A
 *    handle row therefore shows MARKETPLACE campaigns only (GLOBAL or
 *    INVITE_ONLY, with a public slug) -- which is exactly what the portal
 *    showed before this module, and nothing a stranger could not already find
 *    on /explore.
 *
 * Plan failure F10 is the reason for the split: listing a private campaign by
 * handle would let anyone register LKM's creators' handles and read LKM's
 * campaigns, briefs and dates.
 */

export type IdentityRosterRow = { id: string; orgId: string; platform: string; handle: string };

/** Roster rows linked to this login by identity, across every agency. */
export function identityRosterRows(creatorUserId: string): Promise<IdentityRosterRow[]> {
  return db.creator.findMany({
    where: { creatorUserId, deletedAt: null },
    select: { id: true, orgId: true, platform: true, handle: true },
    orderBy: { addedAt: "asc" },
  });
}

export type JoinedCampaign = {
  campaignId: string;
  /** Path of the campaign screen in the creator app. */
  href: string;
  title: string;
  orgName: string;
  campaignStatus: string;
  activationStatus: string;
  /** Whether the campaign still takes posts and drafts at all. */
  actionable: boolean;
  postsSubmitted: number;
  /** The agency's notes on a draft it sent back; null otherwise. */
  feedback: string | null;
  deliverableDueDate: string | null;
  submissionDeadline: string | null;
  next: CampaignDate | null;
};

export type InvitedCampaign = {
  campaignId: string;
  /** The invite's own landing page, where Accept and "Not for me" live. */
  href: string;
  title: string;
  orgName: string;
  submissionDeadline: string | null;
  invitedAt: string;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function listJoinedCampaigns(
  session: Pick<CreatorSession, "creatorUserId" | "handle">,
  now: Date = new Date(),
): Promise<JoinedCampaign[]> {
  const identityRows = await identityRosterRows(session.creatorUserId);
  const identityIds = identityRows.map((r) => r.id);
  const identitySet = new Set(identityIds);
  const handleOnlyIds = (await findCreatorsForHandle(session.handle))
    .map((r) => r.id)
    .filter((id) => !identitySet.has(id));

  const branches = [
    ...(identityIds.length > 0 ? [{ creatorId: { in: identityIds } }] : []),
    ...(handleOnlyIds.length > 0
      ? [
          {
            creatorId: { in: handleOnlyIds },
            campaign: {
              marketplaceVisibility: { not: "PRIVATE" as const },
              publicSlug: { not: null },
            },
          },
        ]
      : []),
  ];
  if (branches.length === 0) return [];

  const activations = await db.activation.findMany({
    where: { deletedAt: null, campaign: { deletedAt: null }, OR: branches },
    select: {
      id: true,
      creatorId: true,
      status: true,
      deliverableDueDate: true,
      feedbackNotes: true,
      campaign: {
        select: {
          id: true,
          title: true,
          status: true,
          publicSlug: true,
          submissionDeadline: true,
          org: { select: { name: true, brandName: true } },
          phases: {
            select: { name: true, startDate: true, endDate: true },
            orderBy: { sequence: "asc" },
          },
        },
      },
      _count: { select: { posts: { where: NOT_REMOVED } } },
    },
    orderBy: { createdAt: "desc" },
  });

  /* The agency's note on a declined draft is written to the creator on that
     roster row, not to whoever registered its handle. The campaign itself is
     public on /explore; the note is not. So a handle-only row shows the note
     only once the login has proven it owns the row (lib/portal/creatorLink.ts,
     the OAuth proof), and the proof is only looked up when such a note exists. */
  const needsProof = activations.some(
    (a) => a.status === "DECLINED" && a.feedbackNotes && !identitySet.has(a.creatorId),
  );
  const provenIds = needsProof
    ? new Set((await findLinkedCreatorsForHandle(session)).map((c) => c.id))
    : identitySet;

  /* One row per campaign. Two roster rows in the same agency can both be on a
     campaign (an import duplicate); the creator still has one campaign. */
  const seen = new Set<string>();
  const out: JoinedCampaign[] = [];
  for (const a of activations) {
    if (seen.has(a.campaign.id)) continue;
    seen.add(a.campaign.id);
    out.push({
      campaignId: a.campaign.id,
      href: portalCampaignPath(a.campaign),
      title: a.campaign.title,
      orgName: a.campaign.org.brandName || a.campaign.org.name,
      campaignStatus: a.campaign.status,
      activationStatus: a.status,
      actionable: isPortalCampaignActionable(a.campaign.status),
      postsSubmitted: a._count.posts,
      feedback:
        a.status === "DECLINED" && a.feedbackNotes && provenIds.has(a.creatorId) ? a.feedbackNotes : null,
      deliverableDueDate: iso(a.deliverableDueDate),
      submissionDeadline: iso(a.campaign.submissionDeadline),
      /* Only a campaign still taking posts has a next date to act on; a
         closed one listed "Your post is due" under its Closed badge. */
      next: isPortalCampaignActionable(a.campaign.status)
        ? nextCampaignDate(
            {
              deliverableDueDate: a.deliverableDueDate,
              submissionDeadline: a.campaign.submissionDeadline,
              phases: a.campaign.phases,
            },
            now,
          )
        : null,
    });
  }
  return out;
}

/**
 * Pending invites addressed to a roster row this login is linked to by
 * identity. An invite names a roster row, not a person, so a row reached only
 * by handle is not enough to call the invite this creator's: that is the same
 * stranger-with-a-handle case as above.
 */
export async function listInvitedCampaigns(
  session: Pick<CreatorSession, "creatorUserId">,
  joinedCampaignIds: ReadonlySet<string> = new Set(),
): Promise<InvitedCampaign[]> {
  const rows = await identityRosterRows(session.creatorUserId);
  if (rows.length === 0) return [];

  const invites = await db.campaignInvite.findMany({
    where: {
      creatorId: { in: rows.map((r) => r.id) },
      status: "PENDING",
      campaign: { deletedAt: null },
    },
    select: {
      inviteToken: true,
      createdAt: true,
      campaign: {
        select: {
          id: true,
          title: true,
          submissionDeadline: true,
          org: { select: { name: true, brandName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const seen = new Set<string>();
  const out: InvitedCampaign[] = [];
  for (const inv of invites) {
    if (joinedCampaignIds.has(inv.campaign.id) || seen.has(inv.campaign.id)) continue;
    seen.add(inv.campaign.id);
    out.push({
      campaignId: inv.campaign.id,
      href: campaignInvitePath(inv.inviteToken),
      title: inv.campaign.title,
      orgName: inv.campaign.org.brandName || inv.campaign.org.name,
      submissionDeadline: iso(inv.campaign.submissionDeadline),
      invitedAt: inv.createdAt.toISOString(),
    });
  }
  return out;
}

export type HomeTodo =
  | { kind: "connect"; title: string; href: string }
  | { kind: "post_due"; title: string; href: string; campaignTitle: string; dueAt: string | null }
  | { kind: "draft_feedback"; title: string; href: string; campaignTitle: string; feedback: string };

/**
 * What needs doing, in the order the creator should do it: connect an account
 * (nothing else reports itself until they do), then posts that are due, then
 * drafts the agency sent back with notes.
 *
 * "Due" is a joined campaign that still takes posts and has none from this
 * creator yet, soonest first; one with no date at all sorts last rather than
 * first, because "no date" is the least urgent thing on the list.
 */
export function buildHomeTodo(joined: ReadonlyArray<JoinedCampaign>, connectedAccounts: number): HomeTodo[] {
  const todo: HomeTodo[] = [];
  if (connectedAccounts === 0) {
    todo.push({ kind: "connect", title: "Connect an account", href: "/portal/accounts" });
  }

  const dueKey = (c: JoinedCampaign) => {
    const at = c.deliverableDueDate ?? c.submissionDeadline;
    return at ? new Date(at).getTime() : Number.POSITIVE_INFINITY;
  };
  const due = joined
    .filter((c) => c.actionable && c.postsSubmitted === 0 && c.activationStatus !== "DECLINED")
    .sort((a, b) => dueKey(a) - dueKey(b));
  for (const c of due) {
    todo.push({
      kind: "post_due",
      title: "Post your content",
      href: c.href,
      campaignTitle: c.title,
      dueAt: c.deliverableDueDate ?? c.submissionDeadline,
    });
  }

  for (const c of joined) {
    if (c.feedback && c.actionable) {
      todo.push({
        kind: "draft_feedback",
        title: "Your draft has feedback",
        href: c.href,
        campaignTitle: c.title,
        feedback: c.feedback,
      });
    }
  }
  return todo;
}
