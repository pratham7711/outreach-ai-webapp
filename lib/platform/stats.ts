/**
 * Platform-operator statistics: the whole business, across every tenant.
 *
 * THIS FILE DELIBERATELY BREAKS THE orgId RULE. Every other query in this
 * codebase is scoped to the caller's organisation, because a tenant reading
 * another tenant's data is the one unrecoverable bug in a multi-tenant product.
 * The rule is suspended here for exactly one reason: this is the layer *above*
 * the tenants -- the operator looking at the platform they run -- and there is
 * no orgId to scope to, because the question is "how many orgs are there".
 *
 * That makes the guard, not the query, the safety property. Nothing in this
 * file authorises anybody. Every caller must have already passed
 * isPlatformAdmin() (lib/billing/subscription.ts), which checks an env
 * allowlist rather than a role -- because every role in this product is granted
 * *within* an org, so an OWNER would otherwise qualify to read the platform.
 * Two callers exist and both check: app/api/platform/stats/route.ts and
 * app/(dashboard)/platform/page.tsx. A third must do the same.
 *
 * Cost discipline: this runs on a screen someone may leave open. Every figure
 * below is a COUNT or a groupBy -- the database aggregates and returns tens of
 * rows, never the 18,703 posts themselves. One raw join exists (posts per org)
 * because Post carries no orgId; it is still an aggregate.
 */
import { db } from "@/lib/db";

/** Counting window for the cost meters. Long enough to cover a billing period. */
export const COST_WINDOW_DAYS = 30;

export type PlatformCount = { total: number; byPlatform: Record<string, number> };

export type TenantRow = {
  id: string;
  name: string;
  subdomain: string;
  orgType: string;
  /** The tier they are on -- Organization.plan, a free-text string, not the Plan model. */
  plan: string;
  subscriptionStatus: string;
  paidThrough: string | null;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  createdAt: string;
  users: number;
  campaigns: number;
  creators: number;
  clients: number;
  posts: number;
  /** Posts this tenant's refreshes actually measured in the window: their share of the sync cost. */
  measuredInWindow: number;
  refreshRunsInWindow: number;
};

export type PlatformStats = {
  generatedAt: string;
  windowDays: number;
  orgs: {
    total: number;
    byStatus: Record<string, number>;
    byPlan: Record<string, number>;
    byType: Record<string, number>;
  };
  creators: {
    /** People who registered a login with us. The honest "signed up" number. */
    portalSignups: PlatformCount;
    /** Rows an agency added to its roster. Mostly NOT people who know we exist. */
    agencyRosters: PlatformCount;
    /** Rosters that additionally connected an API token -- the only ones we can read officially. */
    connectedAccounts: PlatformCount;
  };
  campaigns: { total: number; byStatus: Record<string, number> };
  posts: { total: number; byPlatform: Record<string, number>; deadLettered: number };
  clients: { total: number };
  cost: {
    snapshotsInWindow: number;
    refreshRunsInWindow: number;
    /** Posts the cron may sweep: the recurring bill's actual driver. */
    syncablePosts: number;
    totalSnapshots: number;
    totalRefreshRuns: number;
    totalAuditLogs: number;
  };
  tenants: TenantRow[];
};

/** groupBy rows -> a plain map, so the UI never has to know Prisma's shape. */
function tally<K extends string>(
  rows: Array<Record<string, unknown> & { _count: number | { _all: number } }>,
  key: K,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row[key] ?? "unknown");
    const c = typeof row._count === "number" ? row._count : row._count._all;
    out[k] = (out[k] ?? 0) + c;
  }
  return out;
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export async function getPlatformStats(now: Date = new Date()): Promise<PlatformStats> {
  const since = new Date(now.getTime() - COST_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  /* Deleted rows are excluded everywhere a deletedAt exists. A soft-deleted
     creator is not a creator we have; counting it would inflate the one number
     an operator is most likely to quote to somebody else. */
  const [
    orgs,
    portalByPlatform,
    rosterByPlatform,
    connectedByPlatform,
    campaignsByStatus,
    postsByPlatform,
    deadLettered,
    clientsTotal,
    snapshotsInWindow,
    refreshRunsInWindow,
    syncablePosts,
    totalSnapshots,
    totalRefreshRuns,
    totalAuditLogs,
    runsByOrg,
    postsByOrg,
  ] = await Promise.all([
    db.organization.findMany({
      select: {
        id: true,
        name: true,
        subdomain: true,
        orgType: true,
        plan: true,
        subscriptionStatus: true,
        paidThrough: true,
        trialEndsAt: true,
        suspendedAt: true,
        createdAt: true,
        _count: { select: { users: true, campaigns: true, creators: true, clients: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.creatorUser.groupBy({ by: ["platform"], _count: { _all: true } }),
    db.creator.groupBy({
      by: ["platform"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.creatorSocialAccount.groupBy({ by: ["platform"], _count: { _all: true } }),
    db.campaign.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.post.groupBy({ by: ["platform"], _count: { _all: true } }),
    db.post.count({ where: { syncDisabledAt: { not: null } } }),
    db.client.count(),
    db.postMetricSnapshot.count({ where: { recordedAt: { gte: since } } }),
    db.campaignRefreshRun.count({ where: { startedAt: { gte: since } } }),
    db.post.count({ where: { syncDisabledAt: null } }),
    db.postMetricSnapshot.count(),
    db.campaignRefreshRun.count(),
    db.auditLog.count(),
    db.campaignRefreshRun.groupBy({
      by: ["orgId"],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
      _sum: { measured: true },
    }),
    /* Raw, because Post has no orgId -- it reaches an org only through
       Campaign. Still an aggregate: one row per org comes back, not one per
       post. Interpolation-free; `since` is not used here on purpose, since
       "how many posts does this tenant have" is a stock, not a flow. */
    db.$queryRaw<Array<{ orgId: string; n: bigint }>>`
      SELECT c."orgId" AS "orgId", COUNT(p.id) AS n
      FROM "Post" p
      JOIN "Campaign" c ON c.id = p."campaignId"
      WHERE c."deletedAt" IS NULL
      GROUP BY c."orgId"
    `,
  ]);

  const runsFor = new Map(runsByOrg.map((r) => [r.orgId, r]));
  const postsFor = new Map(postsByOrg.map((r) => [r.orgId, Number(r.n)]));

  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  const portal = tally(portalByPlatform, "platform");
  const roster = tally(rosterByPlatform, "platform");
  const connected = tally(connectedByPlatform, "platform");
  const postPlatforms = tally(postsByPlatform, "platform");
  const campaignStatuses = tally(campaignsByStatus, "status");

  const byStatus: Record<string, number> = {};
  const byPlan: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const o of orgs) {
    byStatus[o.subscriptionStatus] = (byStatus[o.subscriptionStatus] ?? 0) + 1;
    byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1;
    byType[o.orgType] = (byType[o.orgType] ?? 0) + 1;
  }

  return {
    generatedAt: now.toISOString(),
    windowDays: COST_WINDOW_DAYS,
    orgs: { total: orgs.length, byStatus, byPlan, byType },
    creators: {
      portalSignups: { total: sum(portal), byPlatform: portal },
      agencyRosters: { total: sum(roster), byPlatform: roster },
      connectedAccounts: { total: sum(connected), byPlatform: connected },
    },
    campaigns: { total: sum(campaignStatuses), byStatus: campaignStatuses },
    posts: { total: sum(postPlatforms), byPlatform: postPlatforms, deadLettered },
    clients: { total: clientsTotal },
    cost: {
      snapshotsInWindow,
      refreshRunsInWindow,
      syncablePosts,
      totalSnapshots,
      totalRefreshRuns,
      totalAuditLogs,
    },
    tenants: orgs.map((o) => {
      const runs = runsFor.get(o.id);
      return {
        id: o.id,
        name: o.name,
        subdomain: o.subdomain,
        orgType: o.orgType,
        plan: o.plan,
        subscriptionStatus: o.subscriptionStatus,
        paidThrough: iso(o.paidThrough),
        trialEndsAt: iso(o.trialEndsAt),
        suspendedAt: iso(o.suspendedAt),
        createdAt: o.createdAt.toISOString(),
        users: o._count.users,
        campaigns: o._count.campaigns,
        creators: o._count.creators,
        clients: o._count.clients,
        posts: postsFor.get(o.id) ?? 0,
        measuredInWindow: runs?._sum.measured ?? 0,
        refreshRunsInWindow: runs?._count._all ?? 0,
      };
    }),
  };
}
