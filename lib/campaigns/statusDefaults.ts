import type { CampaignStatus } from "@/lib/generated/prisma/client";

/**
 * The bucket a campaign lands in the moment it is created.
 *
 * There is no separate launch step anywhere in the app -- creating a campaign
 * IS starting it, and the invites on a self-serve campaign go out in the same
 * request -- so a new campaign is Active. It used to be DRAFT, which has no tab
 * on the campaigns page and no status def pointing at it, so a freshly created
 * campaign was reachable only through "All" and rendered as "No status".
 */
export const CAMPAIGN_START_STATUS: CampaignStatus = "IN_PROGRESS";

/** The shape this module needs off a CampaignStatusDef row. */
export type StatusDefLike = {
  id: string;
  name: string;
  bucket: string;
  sortOrder: number;
};

/**
 * The names an org is likely to have given a bucket. Matched against the def's
 * own name so a bucket resolves to the status that means the same thing rather
 * than merely the first one filed under it -- CANCELLED holds both "Paused"
 * (sortOrder 6) and "Canceled" (7), and a cancelled campaign is not paused.
 */
const BUCKET_ALIASES: Record<string, readonly string[]> = {
  DRAFT: ["draft"],
  PENDING: ["pending"],
  IN_PROGRESS: ["inprogress", "active"],
  COMPLETE: ["complete", "completed"],
  CANCELLED: ["cancelled", "canceled"],
};

const normalise = (name: string) => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

/**
 * The org's own named status to use for a bucket when nobody picked one.
 *
 * Returns null only when the org has defined no status for that bucket at all,
 * which is the one case a campaign legitimately carries no named status.
 */
export function defaultStatusDefFor<T extends StatusDefLike>(
  bucket: string,
  defs: readonly T[],
): T | null {
  const inBucket = defs
    .filter((d) => d.bucket === bucket)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  if (inBucket.length === 0) return null;

  const aliases = BUCKET_ALIASES[bucket] ?? [];
  return inBucket.find((d) => aliases.includes(normalise(d.name))) ?? inBucket[0];
}

/** The select every caller uses, so the shape and `defs` stay in step. */
export const STATUS_DEF_SELECT = {
  id: true,
  name: true,
  bucket: true,
  sortOrder: true,
} as const;
