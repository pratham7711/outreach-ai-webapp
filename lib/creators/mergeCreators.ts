import type { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";
import { creatorNameParts } from "@/lib/creators/creatorName";

/**
 * Folding a duplicate creator into the one to keep.
 *
 * The same person ends up on the roster twice when a CreatorCore import filed
 * their posts under a display name while the sign-up sheet added them under
 * their real handle, or when a renamed account was signed up again. Merging
 * moves everything the duplicate carries onto the kept creator and retires the
 * duplicate, so campaigns, lists and payouts all read one profile.
 *
 * The kept creator's own identity never changes: its name, handle, platform and
 * counts stay, and the duplicate only fills what it leaves blank. The duplicate
 * is soft-deleted, not removed, so nothing it held is destroyed; its tracker
 * history and picture stay with it, since they describe its own account.
 */

type DetailFields = {
  country: string | null;
  audienceCountry: string | null;
  niche: string | null;
  source: string | null;
  signedUpAt: Date | null;
};

export type MergeSide = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  contactEmail: string | null;
  rate: number | null;
  boostRate: number | null;
  bio: string | null;
  paymentInfo: string | null;
  notes: string | null;
  niches: string[];
  trackedSince: Date | null;
  creatorUserId: string | null;
  links: { id: string; platform: string; handle: string; isPrimary: boolean }[];
  detail: DetailFields | null;
  activations: { id: string; campaignId: string }[];
  tagIds: string[];
  flagIds: string[];
  lists: { listId: string; addedAt: Date }[];
  socialAccounts: { id: string; platform: string; platformUserId: string | null }[];
};

export type MergePlan = {
  creator: Record<string, unknown>;
  filled: string[];
  links: { id: string; isPrimary: boolean }[];
  detail: { move: true } | { fill: Partial<DetailFields> } | null;
  activations: { move: string[]; fold: { from: string; into: string }[] };
  tagIds: string[];
  flagIds: string[];
  lists: { listId: string; addedAt: Date }[];
  socialAccountIds: string[];
};

const FILLABLE = ["contactEmail", "rate", "boostRate", "bio", "paymentInfo"] as const;

const blank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

const sameAccount = (platform: string, handle: string, keep: MergeSide) =>
  platform === keep.platform && stripAt(handle).toLowerCase() === stripAt(keep.handle).toLowerCase();

const earliest = (a: Date | null, b: Date | null) => (a && b ? (a <= b ? a : b) : a ?? b);

export function planMerge(keep: MergeSide, drop: MergeSide): { ok: true; plan: MergePlan } | { ok: false; error: string } {
  if (keep.id === drop.id) return { ok: false, error: "A creator can't be merged into itself." };
  if (keep.creatorUserId && drop.creatorUserId && keep.creatorUserId !== drop.creatorUserId) {
    return { ok: false, error: "Both creators have signed in to the portal as different people, so they can't be merged." };
  }

  const creator: Record<string, unknown> = {};
  const filled: string[] = [];
  const fill = (field: string, value: unknown) => {
    creator[field] = value;
    filled.push(field);
  };

  if (!creatorNameParts(keep.name, keep.handle).handle && creatorNameParts(drop.name, drop.handle).handle) fill("name", drop.name);
  for (const f of FILLABLE) if (blank(keep[f]) && !blank(drop[f])) fill(f, drop[f]);

  const keptNotes = keep.notes?.trim() || null;
  const dropNotes = drop.notes?.trim() || null;
  if (dropNotes && !keptNotes) fill("notes", dropNotes);
  else if (dropNotes && keptNotes && !keptNotes.includes(dropNotes)) fill("notes", `${keptNotes}\n\n${dropNotes}`);

  const niches = [...new Set([...keep.niches, ...drop.niches])];
  if (niches.length > keep.niches.length) fill("niches", niches);

  const tracked = earliest(keep.trackedSince, drop.trackedSince);
  if (tracked && tracked !== keep.trackedSince) fill("trackedSince", tracked);

  if (!keep.creatorUserId && drop.creatorUserId) fill("creatorUserId", drop.creatorUserId);

  const keepHasPrimary = keep.links.some((l) => l.isPrimary);
  const links = drop.links.map((l) => ({
    id: l.id,
    isPrimary: !keepHasPrimary && l.isPrimary && sameAccount(l.platform, l.handle, keep),
  }));

  let detail: MergePlan["detail"] = null;
  if (drop.detail && !keep.detail) detail = { move: true };
  else if (drop.detail && keep.detail) {
    const d: Partial<DetailFields> = {};
    for (const k of ["country", "audienceCountry", "niche", "source"] as const) {
      if (blank(keep.detail[k]) && !blank(drop.detail[k])) d[k] = drop.detail[k];
    }
    const signed = earliest(keep.detail.signedUpAt, drop.detail.signedUpAt);
    if (signed && signed !== keep.detail.signedUpAt) d.signedUpAt = signed;
    if (Object.keys(d).length) detail = { fill: d };
  }

  const keptCampaigns = new Map(keep.activations.map((a) => [a.campaignId, a.id]));
  const activations: MergePlan["activations"] = { move: [], fold: [] };
  for (const a of drop.activations) {
    const into = keptCampaigns.get(a.campaignId);
    if (into) activations.fold.push({ from: a.id, into });
    else {
      activations.move.push(a.id);
      keptCampaigns.set(a.campaignId, a.id);
    }
  }

  const keptSocial = new Set(keep.socialAccounts.map((s) => `${s.platform}:${s.platformUserId}`));
  const keptTags = new Set(keep.tagIds);
  const keptFlags = new Set(keep.flagIds);
  const keptLists = new Set(keep.lists.map((l) => l.listId));

  return {
    ok: true,
    plan: {
      creator,
      filled,
      links,
      detail,
      activations,
      tagIds: drop.tagIds.filter((t) => !keptTags.has(t)),
      flagIds: drop.flagIds.filter((f) => !keptFlags.has(f)),
      lists: drop.lists.filter((l) => !keptLists.has(l.listId)),
      socialAccountIds: drop.socialAccounts.filter((s) => !keptSocial.has(`${s.platform}:${s.platformUserId}`)).map((s) => s.id),
    },
  };
}

export async function loadMergeSide(orgId: string, id: string, roster: boolean): Promise<MergeSide | null> {
  const c = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      handle: true,
      platform: true,
      contactEmail: true,
      rate: true,
      boostRate: true,
      bio: true,
      paymentInfo: true,
      notes: true,
      niches: true,
      trackedSince: true,
      creatorUserId: true,
      activations: { where: { deletedAt: null }, select: { id: true, campaignId: true } },
      tagLinks: { select: { tagId: true } },
      flagLinks: { select: { flagId: true } },
      listItems: { select: { listId: true, addedAt: true } },
      socialAccounts: { select: { id: true, platform: true, platformUserId: true } },
    },
  });
  if (!c) return null;
  const [links, detail] = roster
    ? await Promise.all([
        db.creatorProfileLink.findMany({
          where: { orgId, creatorId: id },
          select: { id: true, platform: true, handle: true, isPrimary: true },
        }),
        db.creatorDetail.findFirst({
          where: { orgId, creatorId: id },
          select: { country: true, audienceCountry: true, niche: true, source: true, signedUpAt: true },
        }),
      ])
    : [[], null];
  const { tagLinks, flagLinks, listItems, ...rest } = c;
  return {
    ...rest,
    niches: [...c.niches],
    links,
    detail,
    tagIds: tagLinks.map((t) => t.tagId),
    flagIds: flagLinks.map((f) => f.flagId),
    lists: listItems,
  };
}

type Tx = Prisma.TransactionClient;

/**
 * Rows that belong to the duplicate and simply change hands. Some of these
 * tables are newer than production's schema in places, so each is counted
 * first and a missing table reads as nothing to move.
 */
const OWNED_ROWS = {
  posts: { count: (id: string) => db.post.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.post.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  payouts: { count: (id: string) => db.payout.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.payout.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  payoutRequests: { count: (id: string) => db.payoutRequest.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.payoutRequest.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  offers: { count: (id: string) => db.negotiationOffer.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.negotiationOffer.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  invites: { count: (id: string) => db.campaignInvite.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.campaignInvite.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  reviews: { count: (id: string) => db.creatorReview.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.creatorReview.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  viewLedger: { count: (id: string) => db.viewLedger.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.viewLedger.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
  fraudFlags: { count: (id: string) => db.viewFraudFlag.count({ where: { creatorId: id } }), move: (tx: Tx, from: string, to: string) => tx.viewFraudFlag.updateMany({ where: { creatorId: from }, data: { creatorId: to } }) },
} as const;

type OwnedKind = keyof typeof OWNED_ROWS;

const missingTable = (err: unknown) => {
  const code = (err as { code?: string } | null)?.code;
  return code === "P2021" || code === "P2022";
};

async function countOrNone(read: () => Promise<number>): Promise<number> {
  try {
    return await read();
  } catch (err) {
    if (missingTable(err)) return 0;
    throw err;
  }
}

export async function countOwnedRows(dropId: string): Promise<Record<OwnedKind, number>> {
  const kinds = Object.keys(OWNED_ROWS) as OwnedKind[];
  const counts = await Promise.all(kinds.map((k) => countOrNone(() => OWNED_ROWS[k].count(dropId))));
  return Object.fromEntries(kinds.map((k, i) => [k, counts[i]])) as Record<OwnedKind, number>;
}

/** Both creators were on the same campaign: the kept activation takes over the duplicate's posts and deliverables. */
async function foldActivation(tx: Tx, dropId: string, from: string, into: string, now: Date, deliverables: boolean, ledger: boolean) {
  await tx.post.updateMany({ where: { activationId: from }, data: { activationId: into } });
  if (deliverables) await tx.deliverable.updateMany({ where: { activationId: from }, data: { activationId: into } });
  if (ledger) await tx.viewLedger.updateMany({ where: { activationId: from }, data: { activationId: into } });
  await tx.activation.updateMany({ where: { id: from, creatorId: dropId }, data: { deletedAt: now } });
}

export type MergeSummary = {
  filled: string[];
  links: number;
  activations: number;
  lists: number;
  tags: number;
  flags: number;
} & Record<OwnedKind, number>;

export function summarise(plan: MergePlan, owned: Record<OwnedKind, number>): MergeSummary {
  return {
    filled: plan.filled,
    links: plan.links.length,
    activations: plan.activations.move.length + plan.activations.fold.length,
    lists: plan.lists.length,
    tags: plan.tagIds.length,
    flags: plan.flagIds.length,
    ...owned,
  };
}

export async function executeMerge(orgId: string, keep: MergeSide, drop: MergeSide, plan: MergePlan, owned: Record<OwnedKind, number>) {
  const now = new Date();
  const folds = plan.activations.fold.map((f) => f.from);
  const [deliverables, ledger] = folds.length
    ? await Promise.all([
        countOrNone(() => db.deliverable.count({ where: { activationId: { in: folds } } })),
        countOrNone(() => db.viewLedger.count({ where: { activationId: { in: folds } } })),
      ])
    : [0, 0];
  const kits = await db.mediaKit.findMany({ where: { orgId }, select: { id: true, creatorIds: true } });
  const kitsWithDrop = kits.filter((k) => Array.isArray(k.creatorIds) && (k.creatorIds as unknown[]).includes(drop.id));

  await db.$transaction(
    async (tx) => {
      await tx.creator.update({ where: { id: drop.id, orgId }, data: { deletedAt: now, creatorUserId: null } });
      if (Object.keys(plan.creator).length) await tx.creator.update({ where: { id: keep.id, orgId }, data: plan.creator });

      const primary = plan.links.filter((l) => l.isPrimary).map((l) => l.id);
      const secondary = plan.links.filter((l) => !l.isPrimary).map((l) => l.id);
      if (primary.length) await tx.creatorProfileLink.updateMany({ where: { orgId, creatorId: drop.id, id: { in: primary } }, data: { creatorId: keep.id, isPrimary: true } });
      if (secondary.length) await tx.creatorProfileLink.updateMany({ where: { orgId, creatorId: drop.id, id: { in: secondary } }, data: { creatorId: keep.id, isPrimary: false } });

      if (plan.detail && "move" in plan.detail) await tx.creatorDetail.update({ where: { creatorId: drop.id }, data: { creatorId: keep.id } });
      else if (plan.detail) await tx.creatorDetail.update({ where: { creatorId: keep.id }, data: plan.detail.fill });

      if (plan.activations.move.length) {
        await tx.activation.updateMany({ where: { id: { in: plan.activations.move }, creatorId: drop.id }, data: { creatorId: keep.id } });
      }
      for (const f of plan.activations.fold) await foldActivation(tx, drop.id, f.from, f.into, now, deliverables > 0, ledger > 0);

      for (const k of Object.keys(OWNED_ROWS) as OwnedKind[]) if (owned[k] > 0) await OWNED_ROWS[k].move(tx, drop.id, keep.id);

      if (plan.tagIds.length) await tx.creatorTagLink.createMany({ data: plan.tagIds.map((tagId) => ({ creatorId: keep.id, tagId })), skipDuplicates: true });
      await tx.creatorTagLink.deleteMany({ where: { creatorId: drop.id } });
      if (plan.flagIds.length) await tx.creatorFlagLink.createMany({ data: plan.flagIds.map((flagId) => ({ creatorId: keep.id, flagId })), skipDuplicates: true });
      await tx.creatorFlagLink.deleteMany({ where: { creatorId: drop.id } });
      if (plan.lists.length) {
        await tx.creatorListItem.createMany({ data: plan.lists.map((l) => ({ listId: l.listId, creatorId: keep.id, addedAt: l.addedAt })), skipDuplicates: true });
      }
      await tx.creatorListItem.deleteMany({ where: { creatorId: drop.id } });

      if (plan.socialAccountIds.length) {
        await tx.creatorSocialAccount.updateMany({ where: { id: { in: plan.socialAccountIds }, creatorId: drop.id }, data: { creatorId: keep.id } });
      }

      for (const k of kitsWithDrop) {
        const ids = [...new Set((k.creatorIds as string[]).map((id) => (id === drop.id ? keep.id : id)))];
        await tx.mediaKit.update({ where: { id: k.id }, data: { creatorIds: ids } });
      }
    },
    { timeout: 30_000 },
  );
}
