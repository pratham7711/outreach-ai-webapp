import { z } from "zod";
import { db } from "@/lib/db";
import { backfillCampaignStatusDefs } from "@/lib/campaigns/backfillStatusDefs";

/**
 * The org-configurable taxonomy behind Settings → General.
 *
 * The reference keeps six of these lists, and they differ only in which extra
 * column they carry: a flag has an emoji, a deliverable type has a platform, a
 * status has a bucket. One route family over a fixed map of kinds is a great
 * deal less code than six pairs of near-identical CRUD files, and the map is
 * what makes it safe -- `kind` is looked up here, never used to reach a model
 * by name, so an unknown kind is a 404 rather than a way to address any table.
 *
 * Statuses carry a bucket rather than replacing the existing enums. Our
 * CampaignStatus values already are the reference's four groups, so the enum
 * column stays authoritative for filtering and reporting and the named status
 * hangs off it. Deleting a definition is therefore safe: the foreign keys are
 * ON DELETE SET NULL, so a campaign falls back to its bucket instead of
 * pointing at nothing -- and for campaigns the routes then re-name it from
 * that bucket, because a campaign is never left without a named status.
 */

/** Minimal shape shared by the six Prisma delegates this route drives. */
type Delegate = {
  findMany: (args: unknown) => Promise<unknown[]>;
  findFirst: (args: unknown) => Promise<unknown>;
  create: (args: unknown) => Promise<unknown>;
  createMany: (args: unknown) => Promise<{ count: number }>;
  count: (args: unknown) => Promise<number>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

const CAMPAIGN_BUCKETS = ["PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED", "DRAFT"] as const;
const ACTIVATION_BUCKETS = [
  "AWAITING_DRAFT", "DRAFT_SUBMITTED", "AWAITING_APPROVAL", "APPROVED",
  "POSTING", "POSTED", "COMPLETE", "DECLINED",
] as const;

const PLATFORMS = [
  "TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER", "FACEBOOK",
  "TWITCH", "THREADS", "PINTEREST", "SNAPCHAT", "LINKEDIN",
] as const;

const name = z.string().trim().min(1).max(120);

export const TAXONOMY_KINDS = {
  "creator-tags": {
    delegate: () => db.creatorTagDef as unknown as Delegate,
    auditType: "creator_tag",
    select: { id: true, name: true, sortOrder: true },
    fields: z.object({ name, sortOrder: z.number().int().optional() }),
  },
  "creator-flags": {
    delegate: () => db.creatorFlagDef as unknown as Delegate,
    auditType: "creator_flag",
    select: { id: true, name: true, emoji: true, sortOrder: true },
    // The reference renders a flag as "⚡ Fast Turnaround" -- the glyph is part
    // of the label the org chose, so it is stored, not generated.
    fields: z.object({
      name,
      emoji: z.string().trim().max(16).nullable().optional(),
      sortOrder: z.number().int().optional(),
    }),
  },
  "campaign-tags": {
    delegate: () => db.campaignTagDef as unknown as Delegate,
    auditType: "campaign_tag",
    select: { id: true, name: true, sortOrder: true },
    fields: z.object({ name, sortOrder: z.number().int().optional() }),
  },
  "deliverable-types": {
    delegate: () => db.deliverableTypeDef as unknown as Delegate,
    auditType: "deliverable_type",
    select: { id: true, name: true, platform: true, sortOrder: true },
    fields: z.object({
      name,
      platform: z.enum(PLATFORMS).nullable().optional(),
      sortOrder: z.number().int().optional(),
    }),
  },
  "campaign-statuses": {
    delegate: () => db.campaignStatusDef as unknown as Delegate,
    auditType: "campaign_status",
    select: { id: true, name: true, bucket: true, sortOrder: true },
    fields: z.object({
      name,
      bucket: z.enum(CAMPAIGN_BUCKETS),
      sortOrder: z.number().int().optional(),
    }),
  },
  "activation-statuses": {
    delegate: () => db.activationStatusDef as unknown as Delegate,
    auditType: "activation_status",
    select: { id: true, name: true, bucket: true, sortOrder: true },
    fields: z.object({
      name,
      bucket: z.enum(ACTIVATION_BUCKETS),
      sortOrder: z.number().int().optional(),
    }),
  },
} as const;

export type TaxonomyKind = keyof typeof TAXONOMY_KINDS;

export function isTaxonomyKind(value: string): value is TaxonomyKind {
  return Object.prototype.hasOwnProperty.call(TAXONOMY_KINDS, value);
}

/**
 * What the reference ships an org with. Seeding these rather than leaving the
 * lists empty is the difference between a settings page that mirrors the
 * reference and one that merely could.
 */
export const REFERENCE_DEFAULTS = {
  campaignStatuses: [
    { name: "Pending", bucket: "PENDING", sortOrder: 0 },
    { name: "In-Progress", bucket: "IN_PROGRESS", sortOrder: 1 },
    { name: "Need To Invoice", bucket: "IN_PROGRESS", sortOrder: 2 },
    { name: "Invoiced", bucket: "IN_PROGRESS", sortOrder: 3 },
    { name: "Paid", bucket: "IN_PROGRESS", sortOrder: 4 },
    { name: "Complete", bucket: "COMPLETE", sortOrder: 5 },
    { name: "Paused", bucket: "CANCELLED", sortOrder: 6 },
    { name: "Canceled", bucket: "CANCELLED", sortOrder: 7 },
  ],
  activationStatuses: [
    { name: "Pending", bucket: "AWAITING_DRAFT", sortOrder: 0 },
    { name: "Invited", bucket: "AWAITING_DRAFT", sortOrder: 1 },
    { name: "In-Progress", bucket: "POSTING", sortOrder: 2 },
    { name: "Complete — Awaiting Payout", bucket: "POSTED", sortOrder: 3 },
    { name: "Complete — Paid", bucket: "COMPLETE", sortOrder: 4 },
    { name: "Canceled", bucket: "DECLINED", sortOrder: 5 },
  ],
  creatorFlags: [
    { name: "Fast Turnaround", emoji: "⚡", sortOrder: 0 },
    { name: "Good Views", emoji: "👀", sortOrder: 1 },
    { name: "Not Responding", emoji: "🚫", sortOrder: 2 },
    { name: "On Break", emoji: "⏸️", sortOrder: 3 },
  ],
  deliverableTypes: [
    { name: "Instagram Feed Post", platform: "INSTAGRAM", sortOrder: 0 },
    { name: "Instagram Story", platform: "INSTAGRAM", sortOrder: 1 },
    { name: "Instagram Reel", platform: "INSTAGRAM", sortOrder: 2 },
    { name: "TikTok Song Promo", platform: "TIKTOK", sortOrder: 3 },
    { name: "TikTok Brand Promo", platform: "TIKTOK", sortOrder: 4 },
  ],
} as const;

/**
 * Which kinds have a starter set. Tags deliberately have none in either list:
 * the reference ships no default creator or campaign tags, and inventing some
 * would put words in an org's mouth that it then has to delete.
 */
const DEFAULTS_BY_KIND: Partial<Record<TaxonomyKind, readonly Record<string, unknown>[]>> = {
  "campaign-statuses": REFERENCE_DEFAULTS.campaignStatuses,
  "activation-statuses": REFERENCE_DEFAULTS.activationStatuses,
  "creator-flags": REFERENCE_DEFAULTS.creatorFlags,
  "deliverable-types": REFERENCE_DEFAULTS.deliverableTypes,
};

/**
 * Seeds one list's reference defaults for an org that has none of them.
 *
 * Called from the list's own GET, so it costs one COUNT on the read path and
 * fires at most once per org per list. Deliberately NOT "seed if fewer than N":
 * an org that has deleted a status it does not use must not have it grow back.
 * Empty is the only condition, and `skipDuplicates` makes two simultaneous
 * first reads converge on the same rows rather than colliding on the
 * (orgId, name) unique.
 *
 * Returns the number of rows created, 0 when there was nothing to do.
 */
export async function seedReferenceDefaults(kind: TaxonomyKind, orgId: string): Promise<number> {
  const defaults = DEFAULTS_BY_KIND[kind];
  if (!defaults || defaults.length === 0) return 0;

  const delegate = TAXONOMY_KINDS[kind].delegate();
  try {
    const existing = await delegate.count({ where: { orgId } });
    if (existing > 0) return 0;

    const result = await delegate.createMany({
      data: defaults.map((row) => ({ orgId, ...row })),
      skipDuplicates: true,
    });

    /* Campaigns written before this org had any statuses carry none. The
       control they render in falls back to the buckets while the list is
       empty, so they looked right until this moment -- seeding is exactly
       when they would start showing blank. */
    if (kind === "campaign-statuses" && (result?.count ?? 0) > 0) {
      await backfillCampaignStatusDefs(orgId);
    }

    return result?.count ?? 0;
  } catch {
    /* Seeding is a convenience on a read path. If it fails — a race that beat
       skipDuplicates, a transient connection — the caller still gets whatever
       rows exist, which is the answer it asked for. */
    return 0;
  }
}
