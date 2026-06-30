/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/mcp/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findMany: jest.fn(), findFirst: jest.fn() },
    creator: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    payout: { findMany: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
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
    expect(body.service).toBe("Outreach AI MCP");
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
    expect(body.result.serverInfo.name).toBe("Outreach AI");
    expect(body.result.protocolVersion).toBe("2025-03-26");
  });

  it("lists 5 tools via tools/list", async () => {
    const req = makeJsonRpcRequest("tools/list");
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toHaveLength(5);
    const toolNames = body.result.tools.map((t: any) => t.name).sort();
    expect(toolNames).toEqual([
      "get_campaign",
      "get_org_kpis",
      "list_campaigns",
      "list_creators",
      "search_creators",
    ]);
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

  it("returns KPIs from get_org_kpis", async () => {
    mockDb.post.findMany.mockResolvedValue([
      { viewsCount: 10000, engagementRate: 5.0 },
      { viewsCount: 20000, engagementRate: 3.0 },
    ]);
    mockDb.payout.findMany.mockResolvedValue([
      { amount: 500 },
      { amount: 300 },
    ]);

    const req = makeJsonRpcRequest("tools/call", {
      name: "get_org_kpis",
      arguments: {},
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const kpis = JSON.parse(body.result.content[0].text);

    expect(kpis.totalViews).toBe(30000);
    expect(kpis.totalSpend).toBe(800);
    expect(kpis.totalPosts).toBe(2);
    expect(kpis.totalPayouts).toBe(2);
    expect(kpis.avgCPM).toBeCloseTo(26.67, 1);
    expect(kpis.avgEngagementRate).toBe(4);
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

  it("get_campaign returns campaign not found for wrong org", async () => {
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
});
