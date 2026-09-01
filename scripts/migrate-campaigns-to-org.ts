/**
 * Move campaigns from one tenant to another, taking their posts and creators.
 *
 * Written for handing LKay Media's three campaigns over once they have signed
 * up and own a tenant of their own. Self-serve signup makes an empty org, so
 * without this they log in on day one and see nothing.
 *
 *   npx tsx --env-file=.env scripts/migrate-campaigns-to-org.ts -- \
 *     --to <org-id|subdomain> --campaigns "Shorts/IG LKM,LKM Shorts - April"
 *   ...same again with --apply to write.
 *
 * Why this is not a one-line UPDATE of Campaign.orgId
 * ---------------------------------------------------
 * Post has no orgId. It inherits tenancy through campaignId -> Campaign.orgId,
 * so posts follow their campaign for free. Creator DOES have an orgId, and a
 * creator can appear in campaigns on both sides of the split. Measured on
 * production for the LKM three: 16 creators, only 4 of them exclusive.
 *
 *   exclusive to the moving campaigns -> MOVE the row (update its orgId)
 *   also used by campaigns left behind -> COPY it into the target org and
 *                                         repoint only the moving posts
 *
 * Moving a shared creator outright would strip it from the source org's own
 * campaigns -- for the LKM set that would have taken 500+ posts' creators out
 * of Demo Agency, quietly, with no error. Leaving it behind instead would point
 * the moved posts at a creator the new tenant does not own, which every orgId
 * filter in the app would then hide.
 *
 * What a copy deliberately leaves behind
 * --------------------------------------
 * rate, boostRate, paymentInfo, contactEmail and notes are the agency's
 * commercial terms with that creator, not facts about the creator. The target
 * tenant is the client, so copying those would hand them the agency's own
 * margins. Pass --include-commercial if the two orgs are both yours.
 */
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes("--apply");
  const includeCommercial = process.argv.includes("--include-commercial");
  const toRef = arg("to");
  const titlesRaw = arg("campaigns");

  if (!toRef || !titlesRaw) {
    console.error(`need --to <org-id|subdomain> and --campaigns "Title A,Title B"`);
    process.exit(1);
  }
  const titles = titlesRaw.split(",").map((t) => t.trim()).filter(Boolean);

  const target = await db.organization.findFirst({
    where: { OR: [{ id: toRef }, { subdomain: toRef }] },
    include: { users: { where: { role: "OWNER" }, select: { id: true, email: true }, take: 1 } },
  });
  if (!target) {
    console.error(`no org matched "${toRef}" by id or subdomain`);
    process.exit(1);
  }
  /* Campaign.createdById points at a user, and after the move it would point at
     somebody in the org the campaign just left. The target's OWNER is the only
     defensible stand-in; without one we would be writing a dangling reference. */
  const newOwner = target.users[0];
  if (!newOwner) {
    console.error(`org "${target.name}" has no OWNER to reassign campaigns to. Have them sign up first.`);
    process.exit(1);
  }

  const camps = await db.campaign.findMany({
    where: { title: { in: titles }, deletedAt: null },
    select: { id: true, title: true, orgId: true, createdById: true },
  });

  const missing = titles.filter((t) => !camps.some((c) => c.title === t));
  if (missing.length) {
    console.error(`no campaign found for: ${missing.join(", ")}`);
    process.exit(1);
  }

  const already = camps.filter((c) => c.orgId === target.id);
  if (already.length === camps.length) {
    console.log(`all ${camps.length} campaigns are already in ${target.name}. Nothing to do.`);
    return;
  }
  if (already.length) {
    console.error(`refusing a half-done move: ${already.length} of ${camps.length} campaigns are already in ${target.name}.`);
    process.exit(1);
  }

  const sourceOrgIds = [...new Set(camps.map((c) => c.orgId))];
  if (sourceOrgIds.length > 1) {
    console.error(`campaigns span ${sourceOrgIds.length} source orgs; move them one org at a time.`);
    process.exit(1);
  }
  const sourceOrgId = sourceOrgIds[0];
  const source = await db.organization.findUnique({ where: { id: sourceOrgId }, select: { name: true } });
  const campIds = camps.map((c) => c.id);

  /* One creator per row, with how many of its posts are inside the moving set
     and how many are not. The second number is the whole decision. */
  const usage = await db.$queryRawUnsafe<{ id: string; handle: string; platform: string; inside: bigint; outside: bigint }[]>(
    `SELECT c.id, c.handle, c.platform,
            COUNT(*) FILTER (WHERE p."campaignId" = ANY($1)) AS inside,
            COUNT(*) FILTER (WHERE p."campaignId" <> ALL($1)) AS outside
       FROM "Post" p JOIN "Creator" c ON c.id = p."creatorId"
      WHERE c.id IN (SELECT DISTINCT "creatorId" FROM "Post" WHERE "campaignId" = ANY($1))
      GROUP BY c.id, c.handle, c.platform
      ORDER BY outside DESC, inside DESC`,
    campIds
  );

  const toMove = usage.filter((u) => Number(u.outside) === 0);
  const toCopy = usage.filter((u) => Number(u.outside) > 0);
  const postCount = await db.post.count({ where: { campaignId: { in: campIds } } });

  console.log(`from   ${source?.name} (${sourceOrgId})`);
  console.log(`to     ${target.name} (${target.id}), owner ${newOwner.email}`);
  console.log(`\ncampaigns (${camps.length}):`);
  for (const c of camps) console.log(`  ${c.title}`);
  console.log(`\nposts        ${postCount}  (follow their campaign; Post has no orgId)`);
  console.log(`creators     ${usage.length} touched`);
  console.log(`  move       ${toMove.length}  exclusive to these campaigns`);
  console.log(`  copy       ${toCopy.length}  also used by campaigns staying behind`);
  if (toCopy.length) {
    console.table(toCopy.slice(0, 15).map((u) => ({
      handle: u.handle, platform: u.platform,
      moving: Number(u.inside), staying: Number(u.outside),
    })));
    console.log(`  copies carry identity and public metrics.${includeCommercial
      ? " --include-commercial: rate, paymentInfo, notes and contact WILL be copied."
      : " rate, boostRate, paymentInfo, contactEmail and notes are NOT copied."}`);
  }

  if (!apply) {
    console.log(`\ndry run. re-run with --apply to write.`);
    return;
  }

  const copiedIds: Record<string, string> = {};

  await db.$transaction(async (tx) => {
    for (const u of toCopy) {
      const src = await tx.creator.findUniqueOrThrow({ where: { id: u.id } });
      const data: Prisma.CreatorUncheckedCreateInput = {
        orgId: target.id,
        name: src.name,
        handle: src.handle,
        platform: src.platform,
        platformUserId: src.platformUserId,
        avatarUrl: src.avatarUrl,
        followersCount: src.followersCount,
        averageViews: src.averageViews,
        bio: src.bio,
        niches: src.niches,
        trackedSince: src.trackedSince,
        deletedAt: src.deletedAt,
        ...(includeCommercial
          ? {
              rate: src.rate, boostRate: src.boostRate, paymentInfo: src.paymentInfo,
              contactEmail: src.contactEmail, notes: src.notes,
            }
          : {}),
      };
      const copy = await tx.creator.create({ data });
      copiedIds[u.id] = copy.id;

      /* Only the posts inside the moving campaigns are repointed. The ones
         staying behind keep the original creator, which is the point. */
      await tx.post.updateMany({
        where: { campaignId: { in: campIds }, creatorId: u.id },
        data: { creatorId: copy.id },
      });
    }

    if (toMove.length) {
      await tx.creator.updateMany({
        where: { id: { in: toMove.map((u) => u.id) } },
        data: { orgId: target.id },
      });
    }

    await tx.campaign.updateMany({
      where: { id: { in: campIds } },
      data: { orgId: target.id, createdById: newOwner.id },
    });
  });

  /* Prove it rather than assume it: after the move, no post in these campaigns
     may reference a creator living outside the target org. */
  const strays = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM "Post" p JOIN "Creator" c ON c.id = p."creatorId"
      WHERE p."campaignId" = ANY($1) AND c."orgId" <> $2`,
    campIds, target.id
  );
  const stray = Number(strays[0]?.n ?? 0);

  console.log(`\napplied.`);
  console.log(`  ${camps.length} campaigns and ${postCount} posts now in ${target.name}`);
  console.log(`  ${toMove.length} creators moved, ${toCopy.length} copied`);
  console.log(`  cross-tenant creator references remaining: ${stray}${stray === 0 ? " ✓" : "  <-- INVESTIGATE"}`);
  if (stray > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
