/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as postBriefing } from "@/app/api/ai/briefing/route";
import { POST as postNlQuery } from "@/app/api/ai/nl-query/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { count: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    payout: { aggregate: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    post: { findMany: jest.fn() },
    creator: { count: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

// Hoist-safe: mockMessagesCreate is defined at module scope so jest.mock factory can close over it
const mockMessagesCreate = jest.fn().mockResolvedValue({
  content: [{ type: "text", text: "This is an AI-generated summary." }],
});

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const mockAnthropicCreate = mockMessagesCreate;

const authedSession = { user: { id: "user-1", orgId: "org-1", email: "admin@demo.com" } };

function makeRequest(url: string, body: object) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  process.env.ANTHROPIC_API_KEY = "sk-test-key";

  // Default DB mocks for briefing
  mockDb.campaign.count.mockResolvedValue(3);
  mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 5000 } });
  mockDb.post.findMany.mockResolvedValue([]);

  // Default DB mocks for nl-query
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.creator.count.mockResolvedValue(10);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.payout.count.mockResolvedValue(2);
  mockDb.payout.findMany.mockResolvedValue([]);
});

describe("POST /api/ai/briefing", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postBriefing(makeRequest("http://localhost/api/ai/briefing", { type: "org" }));
    expect(res.status).toBe(401);
  });

  it("returns 503 when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await postBriefing(makeRequest("http://localhost/api/ai/briefing", { type: "org" }));
    expect(res.status).toBe(503);
  });

  it("returns org summary", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Your org had a great month with 3 new campaigns." }],
    });
    const res = await postBriefing(makeRequest("http://localhost/api/ai/briefing", { type: "org" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toContain("great month");
    expect(body.generatedAt).toBeTruthy();
  });

  it("returns 404 for unknown campaign id", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const res = await postBriefing(makeRequest("http://localhost/api/ai/briefing", { type: "campaign", id: "bad-id" }));
    expect(res.status).toBe(404);
  });

  it("returns campaign briefing for valid campaign", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({
      id: "cam-1",
      title: "Summer Drop",
      status: "IN_PROGRESS",
      campaignType: "BUDGET_BASED",
      budget: 10000,
      currency: "USD",
      _count: { activations: 5, posts: 12 },
    });
    mockDb.payout.aggregate.mockResolvedValue({ _sum: { amount: 3500 } });
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Summer Drop is performing well with 12 posts." }],
    });
    const res = await postBriefing(makeRequest("http://localhost/api/ai/briefing", { type: "campaign", id: "cam-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toContain("Summer Drop");
  });
});

describe("POST /api/ai/nl-query", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postNlQuery(makeRequest("http://localhost/api/ai/nl-query", { query: "show campaigns" }));
    expect(res.status).toBe(401);
  });

  it("returns list_campaigns results", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"type":"list_campaigns","status":"IN_PROGRESS"}' }],
    });
    mockDb.campaign.findMany.mockResolvedValue([{ id: "c1", title: "Test", status: "IN_PROGRESS", budget: 1000, currency: "USD", createdAt: new Date() }]);
    const res = await postNlQuery(makeRequest("http://localhost/api/ai/nl-query", { query: "show active campaigns" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent.type).toBe("list_campaigns");
    expect(body.results).toHaveLength(1);
  });

  it("returns get_org_kpis results", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"type":"get_org_kpis"}' }],
    });
    const res = await postNlQuery(makeRequest("http://localhost/api/ai/nl-query", { query: "what are my KPIs?" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intent.type).toBe("get_org_kpis");
    expect(body.results).toHaveProperty("activeCampaigns");
    expect(body.results).toHaveProperty("totalCreators");
  });

  it("returns error message for unknown intent", async () => {
    mockAnthropicCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: '{"type":"unknown"}' }],
    });
    const res = await postNlQuery(makeRequest("http://localhost/api/ai/nl-query", { query: "capital of France?" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toMatch(/couldn't understand/i);
  });

  it("returns 400 when query is missing", async () => {
    const res = await postNlQuery(makeRequest("http://localhost/api/ai/nl-query", {}));
    expect(res.status).toBe(400);
  });
});
