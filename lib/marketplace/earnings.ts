import { db } from "@/lib/db";
import { findCreatorsForHandle } from "@/lib/portal/creatorLookup";
import { findLinkedCreatorsForHandle, type LinkSubject } from "@/lib/portal/creatorLink";

/**
 * The platforms a campaign can pay for, and the single source of that truth.
 *
 * TWITCH is readable by the fetchers but deliberately absent here: making a
 * platform payable is a pricing decision, not a consequence of being able to
 * read it. A campaign reports "does not accept TWITCH submissions" rather than
 * paying at a rate nobody set.
 */
export const PAYABLE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;

export type PlatformKey = (typeof PAYABLE_PLATFORMS)[number];

/**
 * Parse the campaign.ratePerThousand JSON into a typed per-platform map of
 * MINOR units (cents/paise) per 1,000 verified views. Tolerates missing /
 * malformed shapes by returning an empty map.
 */
export function parseRatePerThousand(raw: unknown): Partial<Record<PlatformKey, number>> {
  if (!raw || typeof raw !== "object") return {};
  const out: Partial<Record<PlatformKey, number>> = {};
  for (const key of PAYABLE_PLATFORMS) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = Math.round(v);
  }
  return out;
}

/** Earned minor units for a single post = floor(views/1000 * rate). */
export function earnedMinorForPost(
  views: number,
  platform: string,
  rates: Partial<Record<PlatformKey, number>>
): number {
  const rate = rates[platform as PlatformKey];
  if (!rate || views <= 0) return 0;
  return Math.floor((views / 1000) * rate);
}

export type SubmissionEarning = {
  postId: string;
  postUrl: string;
  platform: string;
  status: string; // PENDING_REVIEW | APPROVED | REJECTED
  viewsCount: number;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: Date;
  earnedMinor: number; // 0 unless APPROVED
  potentialMinor: number; // what it would earn regardless of status
};

export type CampaignEarnings = {
  campaignId: string;
  campaignTitle: string;
  publicSlug: string | null;
  currency: string;
  orgName: string;
  minPayoutMinor: number | null;
  rates: Partial<Record<PlatformKey, number>>;
  submissions: SubmissionEarning[];
  approvedMinor: number; // accrued (APPROVED only) — 0 unless `linked`
  pendingMinor: number; // potential from PENDING_REVIEW — 0 unless `linked`
  submissionCount: number;
  /* Whether this portal user has PROVEN they own the org-side Creator row this
     campaign hangs off (lib/portal/creatorLink.ts). A handle match alone gets
     the campaign listed — agencies roster a creator before that person signs up
     and the portal has to show them their work — but it does not release money.
     False here means every amount on this row is reported as 0. */
  linked: boolean;
};

/**
 * Compute a creator's marketplace earnings, grouped by campaign, across every
 * campaign they've joined (have an Activation for). Accrual counts APPROVED
 * posts only; PENDING_REVIEW posts contribute to `pendingMinor`. Amounts are
 * MINOR units — callers convert to major for display.
 */
export async function computeCreatorEarnings(
  subject: LinkSubject
): Promise<CampaignEarnings[]> {
  const { handle } = subject;
  // Find every org-side Creator row mirroring this portal user. Normalised
  // through the shared matcher: an exact `handle` equality missed rows stored
  // as "@handle" and reported zero earnings for campaigns the creator had
  // joined and been approved on.
  const creators = await findCreatorsForHandle(handle);
  if (creators.length === 0) return [];
  const creatorIds = creators.map((c) => c.id);

  /* Money is gated on proven ownership, the campaign list is not. Registering
     an existing roster creator's handle used to report that creator's accrued
     earnings as the new account's own — and /api/portal/payout-requests now
     sizes a withdrawal off exactly this number. */
  const linkedIds = new Set(
    (await findLinkedCreatorsForHandle(subject)).map((c) => c.id)
  );

  // Activations = the join links. Only marketplace campaigns (publicSlug set).
  const activations = await db.activation.findMany({
    where: { creatorId: { in: creatorIds }, deletedAt: null },
    select: {
      id: true,
      creatorId: true,
      campaign: {
        select: {
          id: true,
          title: true,
          publicSlug: true,
          currency: true,
          ratePerThousand: true,
          minPayoutMinor: true,
          marketplaceVisibility: true,
          org: { select: { name: true } },
        },
      },
    },
  });

  const marketplaceActivations = activations.filter(
    (a) => a.campaign.publicSlug && a.campaign.marketplaceVisibility !== "PRIVATE"
  );
  if (marketplaceActivations.length === 0) return [];

  const activationIds = marketplaceActivations.map((a) => a.id);
  const posts = await db.post.findMany({
    where: { activationId: { in: activationIds } },
    select: {
      id: true,
      activationId: true,
      postUrl: true,
      platform: true,
      status: true,
      viewsCount: true,
      thumbnailUrl: true,
      caption: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const postsByActivation = new Map<string, typeof posts>();
  for (const p of posts) {
    if (!p.activationId) continue;
    const arr = postsByActivation.get(p.activationId) ?? [];
    arr.push(p);
    postsByActivation.set(p.activationId, arr);
  }

  const result: CampaignEarnings[] = [];
  for (const act of marketplaceActivations) {
    const c = act.campaign;
    const linked = linkedIds.has(act.creatorId);
    const rates = parseRatePerThousand(c.ratePerThousand);
    const actPosts = postsByActivation.get(act.id) ?? [];

    let approvedMinor = 0;
    let pendingMinor = 0;
    const submissions: SubmissionEarning[] = actPosts.map((p) => {
      const potentialMinor = linked
        ? earnedMinorForPost(p.viewsCount, p.platform, rates)
        : 0;
      const earnedMinor = p.status === "APPROVED" ? potentialMinor : 0;
      if (p.status === "APPROVED") approvedMinor += earnedMinor;
      if (p.status === "PENDING_REVIEW") pendingMinor += potentialMinor;
      return {
        postId: p.id,
        postUrl: p.postUrl,
        platform: p.platform,
        status: p.status,
        viewsCount: p.viewsCount,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        createdAt: p.createdAt,
        earnedMinor,
        potentialMinor,
      };
    });

    result.push({
      campaignId: c.id,
      campaignTitle: c.title,
      publicSlug: c.publicSlug,
      currency: c.currency,
      orgName: c.org.name,
      minPayoutMinor: c.minPayoutMinor ?? null,
      rates,
      submissions,
      approvedMinor,
      pendingMinor,
      submissionCount: actPosts.length,
      linked,
    });
  }

  return result;
}
