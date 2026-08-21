import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma, type CampaignStatus } from "@/lib/generated/prisma/client";
import CampaignsClient from "./CampaignsClient";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (first(sp.q) ?? "").trim();
  const status = first(sp.status) ?? "ALL";
  const page = Math.max(1, parseInt(first(sp.page) ?? "1", 10) || 1);

  // Search and paginate in the database. Rendering all 512 campaigns with their
  // per-row activation/post counts took ~2.5s server-side and ~7.7s to paint.
  const base: Prisma.CampaignWhereInput = { orgId, deletedAt: null };
  const where: Prisma.CampaignWhereInput = {
    ...base,
    ...(status !== "ALL" ? { status: status as CampaignStatus } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { client: { name: { contains: q, mode: Prisma.QueryMode.insensitive } } },
          ],
        }
      : {}),
  };

  const [campaigns, filteredTotal, statusGroups, creatorCount, clients] = await Promise.all([
    db.campaign.findMany({
      where,
      include: {
        client: { select: { name: true } },
        _count: { select: { activations: true, posts: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: CAMPAIGNS_PAGE_SIZE,
      skip: (page - 1) * CAMPAIGNS_PAGE_SIZE,
    }),
    db.campaign.count({ where }),
    // One grouped query replaces counting each status tab off the full array.
    db.campaign.groupBy({ by: ["status"], where: base, _count: true }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.client.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const statusCounts: Record<string, number> = { ALL: 0 };
  for (const g of statusGroups) {
    statusCounts[g.status] = g._count;
    statusCounts.ALL += g._count;
  }

  // "Creators" is the distinct people attached to a campaign, from either side:
  // an activation (formally assigned) or a post (actually delivered). Counting
  // activations alone read 0 for every CreatorCore campaign, because that type
  // 404s on their Data API and could not be imported — while those same
  // campaigns clearly have posts by real creators. Grouping returns distinct
  // (campaign, creator) pairs, so this stays small even for a campaign with
  // thousands of posts, and only covers the page being shown.
  const visibleIds = campaigns.map((c) => c.id);
  const [postPairs, activationPairs] = await Promise.all([
    db.post.groupBy({ by: ["campaignId", "creatorId"], where: { campaignId: { in: visibleIds } } }),
    db.activation.groupBy({ by: ["campaignId", "creatorId"], where: { campaignId: { in: visibleIds } } }),
  ]);
  const creatorsByCampaign = new Map<string, Set<string>>();
  for (const pair of [...postPairs, ...activationPairs]) {
    const set = creatorsByCampaign.get(pair.campaignId) ?? new Set<string>();
    set.add(pair.creatorId);
    creatorsByCampaign.set(pair.campaignId, set);
  }

  return (
    <CampaignsClient
      campaigns={campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        currency: c.currency,
        client: c.client,
        thumbnailUrl: c.thumbnailUrl,
        _count: c._count,
        creatorCount: creatorsByCampaign.get(c.id)?.size ?? 0,
        updatedAt: c.updatedAt.toISOString(),
      }))}
      stats={{
        total: statusCounts.ALL,
        active: statusCounts.IN_PROGRESS ?? 0,
        creatorCount,
      }}
      statusCounts={statusCounts}
      filteredTotal={filteredTotal}
      page={page}
      q={q}
      status={status}
      clients={clients}
    />
  );
}
