import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma, type Platform } from "@/lib/generated/prisma/client";
import CreatorsClient from "./CreatorsClient";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";

export default async function CreatorsPage({
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
  const platform = first(sp.platform) ?? "All";
  const page = Math.max(1, parseInt(first(sp.page) ?? "1", 10) || 1);

  // Search and paginate in the database: the roster is ~1.8k creators after the
  // CreatorCore import, and shipping all of them was a 1 MB payload per view.
  const base: Prisma.CreatorWhereInput = { orgId, deletedAt: null };
  const where: Prisma.CreatorWhereInput = {
    ...base,
    ...(platform !== "All" ? { platform: platform as Platform } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { handle: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {}),
  };

  const [creators, total, platformGroups] = await Promise.all([
    db.creator.findMany({
      where,
      include: { _count: { select: { activations: true, posts: true } } },
      orderBy: { addedAt: "desc" },
      take: CREATORS_PAGE_SIZE,
      skip: (page - 1) * CREATORS_PAGE_SIZE,
    }),
    db.creator.count({ where }),
    // Tab counts intentionally ignore the search box, matching how they read
    // before pagination: they describe the roster, not the current result set.
    db.creator.groupBy({ by: ["platform"], where: base, _count: true }),
  ]);

  const platformCounts: Record<string, number> = { All: 0 };
  for (const g of platformGroups) {
    platformCounts[g.platform] = g._count;
    platformCounts.All += g._count;
  }

  // averageViews is a hand-editable column that nothing ever populates: 1,833 of
  // 1,834 creators sit at 0 while their posts hold real view counts (steve.i4
  // averages 225k across 356 posts and the column reads "—"). Derive it from the
  // posts instead, over one grouped query for the creators on this page. Posts
  // with no view count are excluded so unfetched zeros cannot drag the mean down.
  // The stored column is deliberately NOT a fallback: the only creator carrying a
  // value has no posts at all, so it rendered a 9.1B average with nothing behind
  // it. No posts means no average, which is what the dash says.
  const derivedAvgViews = new Map<string, number>();
  if (creators.length > 0) {
    const grouped = await db.post.groupBy({
      by: ["creatorId"],
      where: { creatorId: { in: creators.map((c) => c.id) }, viewsCount: { gt: 0 } },
      _avg: { viewsCount: true },
    });
    for (const g of grouped) {
      if (g._avg.viewsCount !== null) derivedAvgViews.set(g.creatorId, Math.round(g._avg.viewsCount));
    }
  }

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
        rate: c.rate ? Number(c.rate) : null,
        _count: c._count,
      }))}
      platformCounts={platformCounts}
      total={total}
      page={page}
      q={q}
      platform={platform}
    />
  );
}
