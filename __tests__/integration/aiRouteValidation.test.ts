/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as postBriefing } from "@/app/api/ai/briefing/route";
import { POST as postNlQuery } from "@/app/api/ai/nl-query/route";
import { GET as getDiscovery } from "@/app/api/discovery/route";
import { POST as postMcp } from "@/app/api/mcp/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    creator: { findMany: jest.fn(), count: jest.fn() },
    post: { findMany: jest.fn() },
    payout: { findMany: jest.fn(), aggregate: jest.fn(), count: jest.fn() },
    apiKey: { findUnique: jest.fn(), update: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasOrgFeature: jest.fn(() => true),
  hasAnyOrgFeature: jest.fn(() => true),
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

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const mockEntitlements = getOrgEntitlements as jest.Mock;

const session = { user: { id: "user-1", orgId: "org-1", email: "u@org-1.test" } };

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(url: string, body: string) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function mcpRequest(body: unknown) {
  return jsonRequest("http://localhost/api/mcp", body);
}

function toolCall(name: string, args: Record<string, unknown>) {
  return mcpRequest({
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args },
    id: 1,
  });
}

function toolPayload(body: any) {
  return JSON.parse(body.result.content[0].text);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  mockAuth.mockResolvedValue(session);
  mockEntitlements.mockResolvedValue({ features: ["creator_discovery"] });
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.campaign.findFirst.mockResolvedValue(null);
  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.creator.count.mockResolvedValue(0);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.payout.count.mockResolvedValue(0);
  mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
  mockMessagesCreate.mockResolvedValue({
    content: [{ type: "text", text: "text" }],
  });
});

describe("POST /api/ai/briefing input validation", () => {
  const url = "http://localhost/api/ai/briefing";

  it.each([
    ["an empty body", {}],
    ["an unrecognised type", { type: "quarterly" }],
    ["a non-string type", { type: 7 }],
    ["a null type", { type: null }],
  ])("rejects %s with 400 and never calls the model", async (_label, body) => {
    const res = await postBriefing(jsonRequest(url, body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("type must be 'org' or 'campaign'");
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockDb.campaign.findFirst).not.toHaveBeenCalled();
  });

  it("rejects type campaign with no id, before any query or model call", async () => {
    const res = await postBriefing(jsonRequest(url, { type: "campaign" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("id is required for type 'campaign'");
    expect(mockDb.campaign.findFirst).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("treats an unparseable body as an empty one rather than throwing", async () => {
    const res = await postBriefing(rawRequest(url, "{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("type must be 'org' or 'campaign'");
  });

  it("checks auth before it checks the body", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postBriefing(jsonRequest(url, { type: "quarterly" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/ai/nl-query input validation", () => {
  const url = "http://localhost/api/ai/nl-query";

  it.each([
    ["a missing query", {}],
    ["an empty query", { query: "" }],
    ["a whitespace-only query", { query: "   \n\t " }],
    ["a numeric query", { query: 42 }],
    ["a null query", { query: null }],
    ["an array query", { query: ["campaigns"] }],
  ])("rejects %s with 400 and never calls the model", async (_label, body) => {
    const res = await postNlQuery(jsonRequest(url, body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("query is required");
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("treats an unparseable body as an empty one rather than throwing", async () => {
    const res = await postNlQuery(rawRequest(url, "]["));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("query is required");
  });

  it("returns 503 rather than 400 when the model key is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await postNlQuery(jsonRequest(url, { query: "" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("AI not configured");
  });

  it("checks auth before it checks the body", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postNlQuery(jsonRequest(url, {}));
    expect(res.status).toBe(401);
  });
});

describe("GET /api/discovery query-parameter handling (hand-rolled, no zod on this route)", () => {
  function discovery(query: string) {
    return getDiscovery(new NextRequest(`http://localhost/api/discovery${query}`));
  }

  it("ignores non-numeric range filters instead of passing NaN to the query", async () => {
    const res = await discovery(
      "?minFollowers=abc&maxFollowers=abc&minRate=abc&maxRate=abc",
    );
    expect(res.status).toBe(200);
    const where = mockDb.creator.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("followersCount");
    expect(where).not.toHaveProperty("rate");
  });

  it("drops empty niche values rather than filtering on an empty string", async () => {
    await discovery("?niches=,,");
    const where = mockDb.creator.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("niches");
  });

  it("falls back to the default sort for an unknown sort key", async () => {
    await discovery("?sort=chaos");
    expect(mockDb.creator.findMany.mock.calls[0][0].orderBy).toEqual({
      followersCount: "desc",
    });
  });

  it("DEFECT, pinned not endorsed: a non-numeric page reaches the query as skip: NaN, and answers 500 on the live server", async () => {
    await discovery("?page=abc");
    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(Number.isNaN(args.skip)).toBe(true);
  });

  it("DEFECT, pinned not endorsed: a non-numeric limit reaches the query as take: NaN, and answers 500 on the live server", async () => {
    await discovery("?limit=abc");
    const args = mockDb.creator.findMany.mock.calls[0][0];
    expect(Number.isNaN(args.take)).toBe(true);
  });

  it("DEFECT, pinned not endorsed: a negative page produces a negative skip, and answers 500 on the live server", async () => {
    await discovery("?page=-5");
    expect(mockDb.creator.findMany.mock.calls[0][0].skip).toBeLessThan(0);
  });

  it("DEFECT, pinned not endorsed: limit is unbounded, so one request can ask the database for 100000 rows", async () => {
    await discovery("?limit=100000");
    expect(mockDb.creator.findMany.mock.calls[0][0].take).toBe(100000);
  });
});

describe("POST /api/mcp JSON-RPC and tool-argument validation", () => {
  it("answers 400 with a parse error for an unparseable body", async () => {
    const res = await postMcp(rawRequest("http://localhost/api/mcp", "{"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("answers 400 with an invalid-request error for a non-object body", async () => {
    const res = await postMcp(mcpRequest("a string"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("rejects a tools/call with no tool name", async () => {
    const res = await postMcp(
      mcpRequest({ jsonrpc: "2.0", method: "tools/call", params: {}, id: 1 }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toBe("Missing tool name");
  });

  it("rejects an unknown method with method-not-found", async () => {
    const res = await postMcp(
      mcpRequest({ jsonrpc: "2.0", method: "tools/summon", id: 1 }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("reports a missing required tool argument in the tool result", async () => {
    const res = await postMcp(toolCall("get_campaign", {}));
    expect(res.status).toBe(200);
    expect(toolPayload(await res.json()).error).toBe("id is required");
  });

  it("checks auth before it parses the body", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postMcp(rawRequest("http://localhost/api/mcp", "{"));
    expect(res.status).toBe(401);
  });
});
