/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/mcp/route";
import { BRAND } from "@/lib/brand";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findMany: jest.fn(), findFirst: jest.fn() },
    creator: { findMany: jest.fn() },
    post: { findMany: jest.fn(), aggregate: jest.fn() },
    payout: { findMany: jest.fn(), aggregate: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
    campaignRefreshRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/entitlements", () => ({
  ...jest.requireActual("@/lib/entitlements"),
  getOrgEntitlements: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { API_ACCESS_FEATURE } from "@/lib/featureKeys";

const mockAuth = auth as jest.Mock;
const mockGetEntitlements = getOrgEntitlements as jest.Mock;
const mockDb = db as any;

function makeJsonRpcRequest(method: string, params: Record<string, unknown> = {}, id = 1) {
  return new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
  mockGetEntitlements.mockResolvedValue({ featureMap: { [API_ACCESS_FEATURE]: true } });
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.campaign.findFirst.mockResolvedValue(null);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.apiKey.update.mockResolvedValue({});
});

describe("GET /api/mcp", () => {
  it("returns service info", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.service).toBe(`${BRAND.name} MCP`);
    expect(body.version).toBe("1.0.0");
  });
});

describe("POST /api/mcp", () => {
  it("returns 401 without auth", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeJsonRpcRequest("initialize");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("handles initialize", async () => {
    const req = makeJsonRpcRequest("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe(BRAND.name);
    expect(body.result.protocolVersion).toBe("2025-03-26");
  });

  it("lists 7 tools via tools/list", async () => {
    const req = makeJsonRpcRequest("tools/list");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toHaveLength(7);
    const toolNames = body.result.tools.map((t: any) => t.name).sort();
    expect(toolNames).toEqual([
      "get_campaign",
      "get_org_kpis",
      "get_refresh_status",
      "list_campaigns",
      "list_creators",
      "refresh_campaign",
      "search_creators",
    ]);
  });

  /* The refresh tool drives the same operation as the Refresh Data button and
     is held to the same thirty-minute limit, because the limit lives inside
     refreshCampaign rather than in the HTTP route. An agent that could refresh
     freely would spend a campaign's platform allowance out from under the
     person clicking the button, and TikTok does not distinguish the two. */
  it("tells an agent how long is left rather than refreshing again", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", song: null });
    mockDb.campaignRefreshRun.findFirst.mockResolvedValue({
      id: "run-0",
      status: "done",
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      finishedAt: new Date(Date.now() - 9 * 60 * 1000),
      total: 5, completed: 5, measured: 5,
      noMetrics: 0, unfetchable: 0, failed: 0, remaining: 0, reasons: {},
    });

    const res = await POST(
      makeJsonRpcRequest("tools/call", { name: "refresh_campaign", arguments: { id: "camp-1" } }),
    );
    const body = await res.json();
    const payload = JSON.parse(body.result.content[0].text);

    expect(payload.refreshed).toBe(false);
    expect(payload.error).toContain("Please wait 20 mins");
    expect(payload.retryAfterSeconds).toBe(20 * 60);
    // The gate is only worth anything if it stops the fetching.
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it("calls list_campaigns and returns data", async () => {
    mockDb.campaign.findMany.mockResolvedValue([
      {
        id: "c1",
        title: "Test Campaign",
        status: "DRAFT",
        campaignType: "BUDGET_BASED",
        budget: 1000,
        currency: "USD",
        _count: { activations: 2, posts: 3 },
      },
    ]);

    const req = makeJsonRpcRequest("tools/call", {
      name: "list_campaigns",
      arguments: { limit: 5 },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.content[0].type).toBe("text");
    const data = JSON.parse(body.result.content[0].text);
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe("Test Campaign");
  });

  it("scopes list_campaigns queries to orgId", async () => {
    mockDb.campaign.findMany.mockResolvedValue([]);
    const req = makeJsonRpcRequest("tools/call", {
      name: "list_campaigns",
      arguments: {},
    });
    await POST(req);

    expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1" }),
      })
    );
  });

  /* get_org_kpis is a second door onto the dashboard's numbers, so it has to
     tell the same story: count in the database, average engagement only over the
     posts it was measured on, and never report a derived figure for something
     nobody measured. */
  async function callKpis() {
    const res = await POST(makeJsonRpcRequest("tools/call", { name: "get_org_kpis", arguments: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    return JSON.parse(body.result.content[0].text);
  }

  it("returns KPIs from get_org_kpis", async () => {
    mockDb.post.aggregate
      .mockResolvedValueOnce({ _sum: { viewsCount: 30000 }, _count: { _all: 2 } })
      // 1,200 engagements over 30,000 measured views = 4.00%.
      .mockResolvedValueOnce({
        _sum: { viewsCount: 30000, likesCount: 1000, commentsCount: 100, sharesCount: 100, savesCount: 0 },
        _count: { _all: 2 },
      });
    mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 800 }, _count: { _all: 2 } });

    const kpis = await callKpis();

    expect(kpis.totalViews).toBe(30000);
    expect(kpis.totalPosts).toBe(2);
    expect(kpis.avgEngagementRate).toBe(4);
    expect(kpis.engagementSample).toBe(2);
    expect(kpis.spendFromRecordedPayouts).toBe(800);
    expect(kpis.recordedPayouts).toBe(2);
  });

  it("no longer reports a CPM derived from one org-wide division", async () => {
    // One recorded payout over every view in the org priced campaigns that had
    // no payout at all. Both inputs are still returned; the ratio is not.
    mockDb.post.aggregate
      .mockResolvedValueOnce({ _sum: { viewsCount: 30000 }, _count: { _all: 2 } })
      .mockResolvedValueOnce({
        _sum: { viewsCount: 30000, likesCount: 1000, commentsCount: 100, sharesCount: 100, savesCount: 0 },
        _count: { _all: 2 },
      });
    mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 800 }, _count: { _all: 1 } });

    const kpis = await callKpis();
    expect(kpis.avgCPM).toBeUndefined();
    expect(kpis.totalSpend).toBeUndefined();
  });

  it("reports null, not zero, for figures nothing was measured for", async () => {
    mockDb.post.aggregate
      .mockResolvedValueOnce({ _sum: { viewsCount: null }, _count: { _all: 0 } })
      .mockResolvedValueOnce({
        _sum: { viewsCount: null, likesCount: null, commentsCount: null, sharesCount: null, savesCount: null },
        _count: { _all: 0 },
      });
    mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: { _all: 0 } });

    const kpis = await callKpis();
    // An org with no measured engagement has no engagement rate — 0.00% would be
    // a claim, and an agent reading this over MCP cannot tell the two apart.
    expect(kpis.avgEngagementRate).toBeNull();
    expect(kpis.spendFromRecordedPayouts).toBeNull();
    expect(kpis.totalViews).toBe(0);
    expect(kpis.recordedPayouts).toBe(0);
  });

  it("counts in the database instead of reading every post row", async () => {
    mockDb.post.aggregate
      .mockResolvedValueOnce({ _sum: { viewsCount: 1 }, _count: { _all: 1 } })
      .mockResolvedValueOnce({
        _sum: { viewsCount: 100, likesCount: 1, commentsCount: 0, sharesCount: 0, savesCount: 0 },
        _count: { _all: 1 },
      });
    mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: { _all: 0 } });

    await callKpis();
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
    expect(mockDb.payout.findMany).not.toHaveBeenCalled();
    // Still scoped to the caller's org on every read.
    for (const call of mockDb.post.aggregate.mock.calls) {
      expect(call[0].where.campaign.orgId).toBe("org-1");
    }
    expect(mockDb.payout.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1" }) })
    );
  });

  it("returns error for unknown tool", async () => {
    const req = makeJsonRpcRequest("tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.message).toContain("Unknown tool");
  });

  it("returns error for unknown method", async () => {
    const req = makeJsonRpcRequest("nonexistent/method");
    const res = await POST(req);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32601);
  });

  it("get_campaign reports not found for an id that does not exist", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeJsonRpcRequest("tools/call", {
      name: "get_campaign",
      arguments: { id: "nonexistent" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = JSON.parse(body.result.content[0].text);
    expect(data.error).toBe("Campaign not found");
  });

  describe("get_campaign cross-tenant isolation", () => {
    const OWNED_CAMPAIGN = {
      id: "camp-owned-by-org-1",
      orgId: "org-1",
      title: "Org 1 confidential launch",
      status: "IN_PROGRESS",
      deletedAt: null,
      tags: [],
      _count: { activations: 2, posts: 3 },
    };

    beforeEach(() => {
      mockDb.campaign.findFirst.mockImplementation(async (args: any) =>
        args?.where?.id === OWNED_CAMPAIGN.id &&
        args?.where?.orgId === OWNED_CAMPAIGN.orgId
          ? OWNED_CAMPAIGN
          : null,
      );
    });

    function requestOwnedCampaign() {
      return makeJsonRpcRequest("tools/call", {
        name: "get_campaign",
        arguments: { id: OWNED_CAMPAIGN.id },
      });
    }

    it("denies a real campaign id belonging to another org, and leaks none of its fields", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-2", orgId: "org-2" } });

      const res = await POST(requestOwnedCampaign());
      expect(res.status).toBe(200);
      const body = await res.json();
      const data = JSON.parse(body.result.content[0].text);

      expect(data.error).toBe("Campaign not found");
      expect(JSON.stringify(body)).not.toContain(OWNED_CAMPAIGN.title);
      expect(JSON.stringify(body)).not.toContain(OWNED_CAMPAIGN.status);
      expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: OWNED_CAMPAIGN.id,
            orgId: "org-2",
          }),
        }),
      );
    });

    it("serves the identical request to the owning org, so the denial above is tenancy and not a missing row", async () => {
      mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
  mockGetEntitlements.mockResolvedValue({ featureMap: { [API_ACCESS_FEATURE]: true } });

      const res = await POST(requestOwnedCampaign());
      expect(res.status).toBe(200);
      const body = await res.json();
      const data = JSON.parse(body.result.content[0].text);

      expect(data.error).toBeUndefined();
      expect(data.id).toBe(OWNED_CAMPAIGN.id);
      expect(data.title).toBe(OWNED_CAMPAIGN.title);
      expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: OWNED_CAMPAIGN.id,
            orgId: "org-1",
          }),
        }),
      );
    });
  });
});
