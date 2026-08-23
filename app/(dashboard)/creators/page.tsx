import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveAverageViews, deriveCampaignCounts } from "@/lib/creatorMetrics";
import CreatorsClient from "./CreatorsClient";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";
import { countCreatorFilters, creatorOrderBy, creatorWhere, readCreatorFilters } from "@/lib/listFilters";
import { firstParam, readCreatorSort } from "@/lib/listParams";

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const sp = await searchParams;
  const page = Math.max(1, parseInt(firstParam(sp.page) ?? "1", 10) || 1);

  // Search, filter and paginate in the database: the roster is ~1.8k creators
  // after the CreatorCore import, and shipping all of them was a 1 MB payload
  // per view. /api/creators reads the same params through the same parse.
  const filters = readCreatorFilters(sp);
  const sort = readCreatorSort(sp);
  const where = creatorWhere(orgId, filters);
  // The platform tabs and the search box are quick filters over the drawer's
  // result set, so they are left out of their own counts.
  const tabBase = creatorWhere(orgId, { ...filters, platform: [], search: undefined });

  const [creators, total, platformGroups, orgTags] = await Promise.all([
    db.creator.findMany({
      where,
      include: { _count: { select: { activations: true, posts: true } } },
      orderBy: creatorOrderBy(sort),
      take: CREATORS_PAGE_SIZE,
      skip: (page - 1) * CREATORS_PAGE_SIZE,
    }),
    db.creator.count({ where }),
    db.creator.groupBy({ by: ["platform"], where: tabBase, _count: true }),
    // Every definition from Settings → General, not only the ones in use: a tag
    // exists because someone created it on purpose.
    db.creatorTagDef.findMany({ where: { orgId }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);

  const platformCounts: Record<string, number> = { All: 0 };
  for (const g of platformGroups) {
    platformCounts[g.platform] = g._count;
    platformCounts.All += g._count;
  }

  // Both measured from the posts: the stored averageViews column is always 0,
  // and counting activations alone reads 0 campaigns for the imported roster.
  const ids = creators.map((c) => c.id);
  const [derivedAvgViews, campaignCounts] = await Promise.all([
    deriveAverageViews(ids),
    deriveCampaignCounts(ids),
  ]);

  return (
    <CreatorsClient
      creators={creators.map((c) => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        platform: c.platform,
        avatarUrl: c.avatarUrl,
        followerCount: c.followersCount,
        avgViews: derivedAvgViews.get(c.id) ?? null,
        campaignCount: campaignCounts.get(c.id) ?? 0,
        _count: c._count,
      }))}
      platformCounts={platformCounts}
      total={total}
      page={page}
      q={filters.search ?? ""}
      platform={filters.platform[0] ?? "All"}
      tagOptions={orgTags.map((t) => t.name)}
      filterValues={{
        minFollowers: firstParam(sp.minFollowers),
        maxFollowers: firstParam(sp.maxFollowers),
        addedFrom: firstParam(sp.addedFrom),
        addedTo: firstParam(sp.addedTo),
        hasPosts: firstParam(sp.hasPosts),
        tags: firstParam(sp.tags),
        excludeTags: firstParam(sp.excludeTags),
      }}
      filterCount={countCreatorFilters({ ...filters, platform: [] })}
      sort={sort}
    />
  );
}
