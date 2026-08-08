/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as postBriefing } from "@/app/api/ai/briefing/route";
import { POST as postNlQuery } from "@/app/api/ai/nl-query/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { AI_ASSISTANT_FEATURE, API_ACCESS_FEATURE } from "@/lib/featureKeys";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    creator: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn() },
    payout: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
    activation: { findMany: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/entitlements", () => ({
  ...jest.requireActual("@/lib/entitlements"),
  getOrgEntitlements: jest.fn(),
}));

jest.mock("@/lib/mcp/tools", () => ({
  getMcpToolDefinitions: jest.fn(() => []),
  executeMcpTool: jest.fn(),
}));

const mockMessagesCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { executeMcpTool } from "@/lib/mcp/tools";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;
const mockGetEntitlements = getOrgEntitlements as jest.Mock;
const mockExecuteMcpTool = executeMcpTool as jest.Mock;

const ORG_ID = "org-1";

function entitlementsWith(...features: string[]) {
  return {
    orgId: ORG_ID,
    planName: "pro",
    features,
    featureMap: Object.fromEntries(features.map((f) => [f, true])),
    limits: { maxCampaigns: 10, maxCreators: 10, maxUsers: 10 },
    branding: {
      brandName: null,
      logoUrl: null,
      faviconUrl: null,
      primaryColor: "#000",
      secondaryColor: "#000",
      accentColor: "#000",
      fontFamily: "sans",
    },
    uiConfig: null,
  };
}

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PAID_ROUTES = [
  {
    name: "POST /api/ai/briefing",
    feature: AI_ASSISTANT_FEATURE,
    call: () => postBriefing(jsonRequest("http://localhost/api/ai/briefing", { type: "org" })),
  },
  {
    name: "POST /api/ai/nl-query",
    feature: AI_ASSISTANT_FEATURE,
    call: () => postNlQuery(jsonRequest("http://localhost/api/ai/nl-query", { query: "what are my KPIs?" })),
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-secret";

  mockAuth.mockResolvedValue({
    user: { id: "user-1", orgId: ORG_ID, email: "u@org-1.test" },
  });

  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.creator.count.mockResolvedValue(0);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.payout.count.mockResolvedValue(0);
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockDb.activation.findMany.mockResolvedValue([]);

  mockMessagesCreate.mockResolvedValue({
    content: [{ type: "text", text: '{"type":"get_org_kpis"}' }],
  });
  mockExecuteMcpTool.mockResolvedValue({ content: [] });
});

describe.each(PAID_ROUTES)("$name entitlement gate", ({ feature, call }) => {
  it("returns 403 and never calls the model when the org lacks the feature", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith("analytics", "media_kits"));

    const res = await call();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("returns 403 and never calls the model when the org has no entitlements at all", async () => {
    mockGetEntitlements.mockResolvedValue(null);

    const res = await call();

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("returns 403 and never calls the model when the feature is explicitly disabled", async () => {
    const entitlements = entitlementsWith(feature);
    entitlements.featureMap[feature] = false;
    mockGetEntitlements.mockResolvedValue(entitlements);

    const res = await call();

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("reaches the model once the org has the feature", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith(feature));

    const res = await call();

    expect(res.status).not.toBe(403);
    expect(mockMessagesCreate).toHaveBeenCalled();
  });
});

describe("POST /api/mcp entitlement gate", () => {
  const listRequest = () =>
    postMcp(jsonRequest("http://localhost/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }));

  const callRequest = () =>
    postMcp(
      jsonRequest("http://localhost/api/mcp", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_campaign", arguments: { id: "c1" } },
      }),
    );

  it("returns 403 on tools/call and never executes a tool without api_access", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith("analytics"));

    const res = await callRequest();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockExecuteMcpTool).not.toHaveBeenCalled();
  });

  it("returns 403 on tools/list without api_access", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith("analytics"));

    expect((await listRequest()).status).toBe(403);
  });

  it("gates before parsing the body, so a malformed request is still 403", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith("analytics"));

    const res = await postMcp(
      new NextRequest("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("serves tools/call once the org has api_access", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith(API_ACCESS_FEATURE));

    const res = await callRequest();

    expect(res.status).toBe(200);
    expect(mockExecuteMcpTool).toHaveBeenCalledWith(ORG_ID, "get_campaign", { id: "c1" });
  });
});

describe("the gate runs before anything billable", () => {
  it("denies every paid AI surface for an org with an empty feature map", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith());

    const statuses = [
      (await postBriefing(jsonRequest("http://localhost/api/ai/briefing", { type: "org" }))).status,
      (await postNlQuery(jsonRequest("http://localhost/api/ai/nl-query", { query: "hi" }))).status,
      (await postMcp(jsonRequest("http://localhost/api/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }))).status,
    ];

    expect(statuses).toEqual([403, 403, 403]);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockExecuteMcpTool).not.toHaveBeenCalled();
  });

  it("rejects a briefing with a valid body but no entitlement, before the body is even validated", async () => {
    mockGetEntitlements.mockResolvedValue(entitlementsWith());

    const res = await postBriefing(jsonRequest("http://localhost/api/ai/briefing", { type: "nonsense" }));

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
