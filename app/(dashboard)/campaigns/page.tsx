import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CampaignsClient from "./CampaignsClient";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";
import { campaignWhere, countCampaignFilters, readCampaignFilters, firstParam } from "@/lib/listFilters";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const sp = await searchParams;
  const page = Math.max(1, parseInt(firstParam(sp.page) ?? "1", 10) || 1);

  // Search, filter and paginate in the database. Rendering all 512 campaigns
  // with their per-row activation/post counts took ~2.5s server-side and ~7.7s
  // to paint. The same parse runs in /api/campaigns, so the table and the API
  // cannot disagree about what a filter means.
  const filters = readCampaignFilters(sp);
  const where = campaignWhere(orgId, filters);
  // Tab counts describe the drawer's result set, so narrowing to one client
  // renumbers the tabs — but the tabs and the search box, being quick filters
  // over that set, are left out of their own counts.
  const tabBase = campaignWhere(orgId, { ...filters, status: [], search: undefined });

  const [campaigns, filteredTotal, statusGroups, creatorCount, clients, orgTags, orgTeam] = await Promise.all([
    db.campaign.findMany({
      where,
      include: {
        client: { select: { name: true } },
        _count: { select: { activations: true, posts: true } },
        teamMembers: { select: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        tags: { select: { tag: true }, orderBy: { tag: "asc" } },
      },
      orderBy: { updatedAt: "desc" },
      take: CAMPAIGNS_PAGE_SIZE,
      skip: (page - 1) * CAMPAIGNS_PAGE_SIZE,
    }),
    db.campaign.count({ where }),
    // One grouped query replaces counting each status tab off the full array.
    db.campaign.groupBy({ by: ["status"], where: tabBase, _count: true }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.client.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Options for the Tags and Team Member filters come from the rows that
    // exist, not from every user in the org. Offering all 113 users when none
    // are assigned to a campaign would be 113 choices that each return nothing;
    // sourcing from the join tables means the filter is either useful or absent.
    db.campaignTag.findMany({
      where: { campaign: { orgId, deletedAt: null } },
      select: { tag: true },
      distinct: ["tag"],
      orderBy: { tag: "asc" },
    }),
    db.campaignTeamMember.findMany({
      where: { campaign: { orgId, deletedAt: null } },
      select: { user: { select: { id: true, name: true } } },
      distinct: ["userId"],
      orderBy: { user: { name: "asc" } },
    }),
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
        // Nullable in the schema, and only 25 of 532 campaigns carry one, so the
        // card omits the chip rather than printing a zero budget that was never set.
        budget: c.budget,
        team: c.teamMembers.map((m) => m.user),
        tags: c.tags.map((t) => t.tag),
      }))}
      stats={{
        total: statusCounts.ALL,
        active: statusCounts.IN_PROGRESS ?? 0,
        creatorCount,
      }}
      statusCounts={statusCounts}
      filteredTotal={filteredTotal}
      page={page}
      q={filters.search ?? ""}
      status={filters.status[0] ?? "ALL"}
      clients={clients}
      tagOptions={orgTags.map((t) => t.tag)}
      teamOptions={orgTeam.map((m) => m.user)}
      filterValues={{
        clientIds: firstParam(sp.clientIds),
        campaignType: firstParam(sp.campaignType),
        createdFrom: firstParam(sp.createdFrom),
        createdTo: firstParam(sp.createdTo),
        hasCreators: firstParam(sp.hasCreators),
        hasPosts: firstParam(sp.hasPosts),
        tags: firstParam(sp.tags),
        teamMemberIds: firstParam(sp.teamMemberIds),
      }}
      filterCount={countCampaignFilters({ ...filters, status: [] })}
    />
  );
}
