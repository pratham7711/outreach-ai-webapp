import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveAverageViewsMeasured, deriveCampaignCounts } from "@/lib/creatorMetrics";
import CreatorsClient from "./CreatorsClient";
import { CREATORS_PAGE_SIZE } from "@/lib/listPageSize";
import { CREATOR_FILTER_KEYS, countCreatorFilters, creatorOrderBy, creatorWhere, readCreatorFilters } from "@/lib/listFilters";
import { firstParam, readCreatorSort } from "@/lib/listParams";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { isFetchableAvatarUrl, storedAvatarVersions } from "@/lib/creators/avatarStore";
import { HANDLE_GONE_WHERE, HANDLE_UNREADABLE_WHERE, handleProblem } from "@/lib/creators/handleCheck";
import { rosterAvgViews, rosterFollowers } from "@/lib/creators/rosterMetrics";
import { creatorAvgViewsTime, creatorFollowersTime, figureTimeDto, linkFollowersTime } from "@/lib/creators/figureTime";
import { latestTrackerReadings } from "@/lib/creators/latestReadings";

/** "United States, Brazil" rows counted per country, most common first. */
function countryOptions(groups: { value: string | null; _count: number }[]) {
  const counts = new Map<string, number>();
  for (const g of groups) {
    for (const c of (g.value ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      counts.set(c, (counts.get(c) ?? 0) + g._count);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ name, n }));
}

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
  const roster = await rosterTablesReady();
  const where = creatorWhere(orgId, filters, { roster });
  // The platform tabs and the search box are quick filters over the drawer's
  // result set, so they are left out of their own counts.
  const tabBase = creatorWhere(orgId, { ...filters, platform: [], search: undefined }, { roster });

  const [creators, total, platformGroups, orgTags] = await Promise.all([
    db.creator.findMany({
      where,
      include: {
        _count: { select: { activations: true, posts: true } },
        tagLinks: { select: { tag: { select: { name: true } } } },
      },
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
  const detailWhere = { orgId, creator: { deletedAt: null } };
  const [derivedAvgViews, campaignCounts, links, details, audienceGroups, countryGroups, avatarVersions, handleGone, handleUnreadable, readings] = await Promise.all([
    deriveAverageViewsMeasured(ids),
    deriveCampaignCounts(ids),
    roster
      ? db.creatorProfileLink.findMany({
          where: { orgId, creatorId: { in: ids } },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            creatorId: true,
            platform: true,
            handle: true,
            url: true,
            followersCount: true,
            averageViews: true,
            isPrimary: true,
            refreshedAt: true,
            refreshError: true,
          },
        })
      : [],
    roster
      ? db.creatorDetail.findMany({ where: { orgId, creatorId: { in: ids } }, select: { creatorId: true, audienceCountry: true, country: true } })
      : [],
    roster ? db.creatorDetail.groupBy({ by: ["audienceCountry"], where: detailWhere, _count: true }) : [],
    roster ? db.creatorDetail.groupBy({ by: ["country"], where: detailWhere, _count: true }) : [],
    storedAvatarVersions(ids, orgId),
    // Across the whole roster, not this page: it is what tells someone there is anything to fix.
    roster ? db.creator.count({ where: { orgId, deletedAt: null, profileLinks: { some: HANDLE_GONE_WHERE } } }) : 0,
    roster
      ? db.creator.count({ where: { orgId, deletedAt: null, profileLinks: { some: HANDLE_UNREADABLE_WHERE, none: HANDLE_GONE_WHERE } } })
      : 0,
    // Dates each row's figures (plan A6); an empty map, never an error, when it cannot.
    latestTrackerReadings(orgId, ids),
  ]);
  const linksBy = new Map<string, typeof links>();
  for (const l of links) linksBy.set(l.creatorId, [...(linksBy.get(l.creatorId) ?? []), l]);
  const detailBy = new Map(details.map((d) => [d.creatorId, d]));

  // What the bulk actions resolve "everything matching" from: the filters and
  // the order, never the page.
  const query = new URLSearchParams();
  for (const key of [...CREATOR_FILTER_KEYS, "sort", "dir"]) {
    const v = firstParam(sp[key]);
    if (v) query.set(key, v);
  }

  return (
    <CreatorsClient
      creators={creators.map((c) => {
        /* "Unknown" is never shown as 0 (plan A1): each figure goes to the page
           as a number or as the reason there is none, decided from the primary
           account's last read -- the read that writes followersCount. */
        const primaryLink = (linksBy.get(c.id) ?? []).find((l) => l.isPrimary) ?? null;
        const facts = { trackerLastAttemptAt: c.trackerLastAttemptAt, trackerLastError: c.trackerLastError, primaryLink };
        const derived = derivedAvgViews.get(c.id) ?? null;
        const avgViews = derived?.value ?? (c.averageViews || null);
        const latestSnapshot = readings.get(c.id) ?? null;
        return {
          id: c.id,
          name: c.name,
          handle: c.handle,
          platform: c.platform,
          avatarUrl: c.avatarUrl,
          // Stored: when it was taken. Not stored but a live link is held: the
          // route stores it on this view. Neither: nothing to ask for.
          avatarVersion: avatarVersions.has(c.id)
            ? avatarVersions.get(c.id)!.toString(36)
            : isFetchableAvatarUrl(c.avatarUrl)
              ? "link"
              : null,
          followerCount: c.followersCount,
          followers: rosterFollowers({ followersCount: c.followersCount, ...facts }),
          // When each figure was measured, and by what -- never a guessed time.
          followersAt: figureTimeDto(creatorFollowersTime({ followersCount: c.followersCount, primaryLink, latestSnapshot })),
          avgViewsAt: figureTimeDto(creatorAvgViewsTime({ derived, averageViews: c.averageViews, primaryLink, latestSnapshot })),
          // Measured from tracked posts where there are any; otherwise what the
          // account's own page last said (import, then the daily refresh).
          avgViews,
          avgViewsFigure: rosterAvgViews(avgViews, c._count.posts, facts),
          campaignCount: campaignCounts.get(c.id) ?? 0,
          _count: c._count,
          rate: c.rate,
          tags: c.tagLinks.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b)),
          links: (linksBy.get(c.id) ?? []).map(({ refreshError, ...l }) => ({
            ...l,
            refreshedAt: l.refreshedAt?.toISOString() ?? null,
            problem: handleProblem(l.platform, refreshError),
            age: figureTimeDto(linkFollowersTime({ ...l, refreshError })),
          })),
          audienceCountry: detailBy.get(c.id)?.audienceCountry ?? null,
        };
      })}
      query={query.toString()}
      rosterReady={roster}
      handleIssues={{ gone: handleGone, unreadable: handleUnreadable }}
      audienceCountryOptions={countryOptions(audienceGroups.map((g) => ({ value: g.audienceCountry, _count: g._count })))}
      countryOptions={countryOptions(countryGroups.map((g) => ({ value: g.country, _count: g._count })))}
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
        minAvgViews: firstParam(sp.minAvgViews),
        maxAvgViews: firstParam(sp.maxAvgViews),
        minRate: firstParam(sp.minRate),
        maxRate: firstParam(sp.maxRate),
        audienceCountry: firstParam(sp.audienceCountry),
        country: firstParam(sp.country),
        accounts: firstParam(sp.accounts),
        handleIssues: firstParam(sp.handleIssues),
      }}
      filterCount={countCreatorFilters({ ...filters, platform: [] })}
      sort={sort}
    />
  );
}
