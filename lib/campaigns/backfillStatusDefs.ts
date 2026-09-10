import { db } from "@/lib/db";
import { STATUS_DEF_SELECT, defaultStatusDefFor } from "@/lib/campaigns/statusDefaults";

/* Split from statusDefaults.ts so that module stays free of a Prisma import:
   the bucket -> status rule is pure, and pulling the client in beside it made
   the plain unit test of that rule need a node environment to run. */
/**
 * Give every campaign in an org that carries no named status the default for
 * its bucket, and report how many were filled in.
 *
 * Two things un-name a campaign that creation and PATCH cannot catch, both of
 * them org-settings actions rather than campaign actions:
 *
 *   - An org acquires its first campaign statuses. Until it has any, the
 *     status control falls back to the buckets and reads correctly, so the
 *     campaigns written in that window carry no statusDefId. The moment the
 *     list is seeded the control switches to named statuses and every one of
 *     those campaigns renders blank.
 *   - A status is deleted. The foreign key is ON DELETE SET NULL, so every
 *     campaign pointing at it is un-named in the same statement.
 *
 * Idempotent, and cheap enough to sit on those two paths: one updateMany per
 * bucket the org has defined, matching only rows that are already null.
 */
export async function backfillCampaignStatusDefs(orgId: string): Promise<number> {
  const defs = await db.campaignStatusDef.findMany({
    where: { orgId },
    select: STATUS_DEF_SELECT,
  });
  if (defs.length === 0) return 0;

  let filled = 0;
  for (const bucket of new Set(defs.map((d) => d.bucket))) {
    const def = defaultStatusDefFor(bucket, defs);
    if (!def) continue;
    const { count } = await db.campaign.updateMany({
      where: { orgId, statusDefId: null, status: bucket },
      data: { statusDefId: def.id },
    });
    filled += count;
  }
  return filled;
}
