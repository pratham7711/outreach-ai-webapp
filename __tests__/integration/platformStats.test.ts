/**
 * @jest-environment node
 *
 * The platform dashboard is the one screen in this product that reads across
 * tenants, so most of what is worth testing here is the door rather than the
 * arithmetic. A regression that let a normal agency OWNER through would hand
 * them every other agency's revenue-shaped numbers in a single response.
 */
import { GET } from "@/app/api/platform/stats/route";
import { getPlatformStats } from "@/lib/platform/stats";

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: jest.fn() },
    creatorUser: { groupBy: jest.fn() },
    creator: { groupBy: jest.fn() },
    creatorSocialAccount: { groupBy: jest.fn() },
    campaign: { groupBy: jest.fn() },
    post: { groupBy: jest.fn(), count: jest.fn() },
    client: { count: jest.fn() },
    postMetricSnapshot: { count: jest.fn() },
    campaignRefreshRun: { count: jest.fn(), groupBy: jest.fn() },
    auditLog: { count: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const realAdmins = process.env.PLATFORM_ADMIN_EMAILS;

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    name: "Acme Agency",
    subdomain: "acme",
    orgType: "AGENCY",
    plan: "starter",
    subscriptionStatus: "ACTIVE",
    paidThrough: new Date("2026-10-01T00:00:00Z"),
    trialEndsAt: null,
    suspendedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    _count: { users: 3, campaigns: 4, creators: 5, clients: 2 },
    ...overrides,
  };
}

/** groupBy rows in Prisma's shape. */
const g = (key: string, pairs: Array<[string, number]>) =>
  pairs.map(([k, n]) => ({ [key]: k, _count: { _all: n } }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PLATFORM_ADMIN_EMAILS = "boss@example.com";

  mockDb.organization.findMany.mockResolvedValue([org()]);
  mockDb.creatorUser.groupBy.mockResolvedValue(g("platform", [["TIKTOK", 7], ["INSTAGRAM", 3]]));
  mockDb.creator.groupBy.mockResolvedValue(g("platform", [["TIKTOK", 900], ["INSTAGRAM", 400]]));
  mockDb.creatorSocialAccount.groupBy.mockResolvedValue(g("platform", [["INSTAGRAM", 12]]));
  mockDb.campaign.groupBy.mockResolvedValue(g("status", [["IN_PROGRESS", 5], ["DRAFT", 2]]));
  mockDb.post.groupBy.mockResolvedValue(g("platform", [["TIKTOK", 60], ["INSTAGRAM", 40]]));
  mockDb.post.count.mockResolvedValue(0);
  mockDb.client.count.mockResolvedValue(9);
  mockDb.postMetricSnapshot.count.mockResolvedValue(500);
  mockDb.campaignRefreshRun.count.mockResolvedValue(20);
  mockDb.campaignRefreshRun.groupBy.mockResolvedValue([
    { orgId: "org-1", _count: { _all: 6 }, _sum: { measured: 41 } },
  ]);
  mockDb.auditLog.count.mockResolvedValue(22);
  mockDb.$queryRaw.mockResolvedValue([{ orgId: "org-1", n: BigInt(62) }]);
});

afterEach(() => {
  if (realAdmins === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = realAdmins;
});

describe("platform stats — the door", () => {
  it("404s an anonymous caller without touching the database", async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(mockDb.organization.findMany).not.toHaveBeenCalled();
  });

  /**
   * The reason the guard is an env allowlist and not a role: every role in this
   * product is granted *within* an org, so the most privileged role there is
   * still must not reach across tenants.
   */
  it("404s an agency OWNER — the highest in-org role is not a platform operator", async () => {
    mockAuth.mockResolvedValue({
      user: { email: "owner@acme.com", orgId: "org-1", role: "OWNER" },
    });

    const res = await GET();

    expect(res.status).toBe(404);
    expect(mockDb.organization.findMany).not.toHaveBeenCalled();
  });

  it("404s, not 403 — a non-operator must not learn the route exists", async () => {
    mockAuth.mockResolvedValue({ user: { email: "nobody@example.com" } });
    expect((await GET()).status).toBe(404);
  });

  it("is inert when PLATFORM_ADMIN_EMAILS is unset, so a misconfigured env fails closed", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    mockAuth.mockResolvedValue({ user: { email: "boss@example.com" } });

    expect((await GET()).status).toBe(404);
    expect(mockDb.organization.findMany).not.toHaveBeenCalled();
  });

  it("lets an allowlisted operator through, case-insensitively", async () => {
    mockAuth.mockResolvedValue({ user: { email: "BOSS@Example.com" } });

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).orgs.total).toBe(1);
  });
});

describe("platform stats — the numbers", () => {
  it("keeps the three creator populations separate", async () => {
    const s = await getPlatformStats();

    // Conflating these is the reporting mistake this dashboard exists to avoid:
    // 1,300 roster rows is not 10 people who signed up with us.
    expect(s.creators.portalSignups).toEqual({
      total: 10,
      byPlatform: { TIKTOK: 7, INSTAGRAM: 3 },
    });
    expect(s.creators.agencyRosters).toEqual({
      total: 1300,
      byPlatform: { TIKTOK: 900, INSTAGRAM: 400 },
    });
    expect(s.creators.connectedAccounts).toEqual({
      total: 12,
      byPlatform: { INSTAGRAM: 12 },
    });
  });

  it("excludes soft-deleted creators and campaigns", async () => {
    await getPlatformStats();

    expect(mockDb.creator.groupBy.mock.calls[0][0].where).toEqual({ deletedAt: null });
    expect(mockDb.campaign.groupBy.mock.calls[0][0].where).toEqual({ deletedAt: null });
  });

  it("counts each org's tier and status", async () => {
    mockDb.organization.findMany.mockResolvedValue([
      org({ id: "a", plan: "starter", subscriptionStatus: "ACTIVE" }),
      org({ id: "b", plan: "pro", subscriptionStatus: "ACTIVE" }),
      org({ id: "c", plan: "pro", subscriptionStatus: "SUSPENDED", orgType: "BRAND" }),
    ]);

    const s = await getPlatformStats();

    expect(s.orgs.total).toBe(3);
    expect(s.orgs.byPlan).toEqual({ starter: 1, pro: 2 });
    expect(s.orgs.byStatus).toEqual({ ACTIVE: 2, SUSPENDED: 1 });
    expect(s.orgs.byType).toEqual({ AGENCY: 2, BRAND: 1 });
  });

  it("attributes posts and sync volume to the right tenant", async () => {
    const s = await getPlatformStats();

    expect(s.tenants).toHaveLength(1);
    expect(s.tenants[0]).toMatchObject({
      id: "org-1",
      name: "Acme Agency",
      plan: "starter",
      subscriptionStatus: "ACTIVE",
      users: 3,
      campaigns: 4,
      creators: 5,
      clients: 2,
      // Through the Campaign join, and coerced off bigint -- JSON cannot carry one.
      posts: 62,
      measuredInWindow: 41,
      refreshRunsInWindow: 6,
    });
    expect(typeof s.tenants[0].posts).toBe("number");
  });

  it("reports zero rather than undefined for a tenant that has never refreshed", async () => {
    mockDb.campaignRefreshRun.groupBy.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([]);

    const s = await getPlatformStats();

    expect(s.tenants[0].measuredInWindow).toBe(0);
    expect(s.tenants[0].refreshRunsInWindow).toBe(0);
    expect(s.tenants[0].posts).toBe(0);
  });

  it("serialises to JSON — a bigint anywhere in the payload would throw", async () => {
    mockAuth.mockResolvedValue({ user: { email: "boss@example.com" } });

    const res = await GET();

    await expect(res.json()).resolves.toBeDefined();
  });

  it("counts the cost window from now, not from epoch", async () => {
    const now = new Date("2026-09-03T00:00:00Z");

    await getPlatformStats(now);

    const since = mockDb.postMetricSnapshot.count.mock.calls[0][0].where.recordedAt.gte as Date;
    expect(since.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });
});
