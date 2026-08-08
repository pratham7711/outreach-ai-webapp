/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as postBriefing } from "@/app/api/ai/briefing/route";
import { POST as postNlQuery } from "@/app/api/ai/nl-query/route";
import { GET as getDiscovery } from "@/app/api/discovery/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { runRouteTriad } from "../helpers/routeTriad";

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

const ORG_A = "org-a";
const ORG_B = "org-b";

const sessionA = {
  user: { id: "user-a", orgId: ORG_A, email: "owner@org-a.test" },
};
const sessionB = {
  user: { id: "user-b", orgId: ORG_B, email: "owner@org-b.test" },
};

const CAMPAIGN_A = {
  id: "camp-org-a-1",
  orgId: ORG_A,
  title: "Org A summer launch",
  status: "IN_PROGRESS",
  campaignType: "BUDGET_BASED",
  budget: 5000,
  currency: "USD",
  createdAt: new Date("2026-01-01"),
  deletedAt: null,
  _count: { activations: 2, posts: 3 },
};

const CREATOR_A = {
  id: "creator-org-a-1",
  orgId: ORG_A,
  name: "Org A Creator",
  handle: "@orgacreator",
  platform: "TIKTOK",
  followersCount: 120000,
  bio: "org a only",
  deletedAt: null,
  _count: { activations: 1, posts: 2 },
};

const PAYOUT_A = {
  id: "payout-org-a-1",
  orgId: ORG_A,
  amount: 750,
  currency: "USD",
  status: "PENDING",
  createdAt: new Date("2026-01-02"),
};

function whereOrg(args: any): string | undefined {
  return args?.where?.orgId ?? args?.where?.campaign?.orgId;
}

function rowsFor<T extends { orgId: string }>(rows: T[], args: any): T[] {
  const orgId = whereOrg(args);
  return rows.filter((row) => row.orgId === orgId);
}

function installTenantAwareDb() {
  mockDb.campaign.findMany.mockImplementation(async (args: any) =>
    rowsFor([CAMPAIGN_A], args),
  );
  mockDb.campaign.findFirst.mockImplementation(async (args: any) => {
    const orgId = whereOrg(args);
    const id = args?.where?.id;
    return CAMPAIGN_A.orgId === orgId && CAMPAIGN_A.id === id
      ? CAMPAIGN_A
      : null;
  });
  mockDb.campaign.count.mockImplementation(
    async (args: any) => rowsFor([CAMPAIGN_A], args).length,
  );
  mockDb.creator.findMany.mockImplementation(async (args: any) =>
    rowsFor([CREATOR_A], args),
  );
  mockDb.creator.count.mockImplementation(
    async (args: any) => rowsFor([CREATOR_A], args).length,
  );
  mockDb.payout.findMany.mockImplementation(async (args: any) =>
    rowsFor([PAYOUT_A], args),
  );
  mockDb.payout.count.mockImplementation(
    async (args: any) => rowsFor([PAYOUT_A], args).length,
  );
  mockDb.payout.aggregate.mockImplementation(async (args: any) => ({
    _sum: {
      amount: rowsFor([PAYOUT_A], args).reduce((sum, p) => sum + p.amount, 0),
    },
  }));
  mockDb.post.findMany.mockImplementation(async (args: any) =>
    whereOrg(args) === ORG_A
      ? [{ viewsCount: 1000, creator: { name: CREATOR_A.name } }]
      : [],
  );
  mockDb.apiKey.findUnique.mockResolvedValue(null);
  mockDb.apiKey.update.mockResolvedValue({});
}

function jsonRequest(url: string, body: object) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonRpcRequest(name: string, args: Record<string, unknown>) {
  return jsonRequest("http://localhost/api/mcp", {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name, arguments: args },
    id: 1,
  });
}

function anthropicText(text: string) {
  mockMessagesCreate.mockResolvedValue({ content: [{ type: "text", text }] });
}

function serialised(body: unknown): string {
  return JSON.stringify(body);
}

function mcpToolPayload(body: any): any {
  return JSON.parse(body.result.content[0].text);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "sk-test-key";
  mockAuth.mockResolvedValue(sessionA);
  mockEntitlements.mockResolvedValue({ features: ["creator_discovery"] });
  installTenantAwareDb();
  anthropicText("summary text");
});

describe("cross-tenant isolation — AI, discovery and MCP routes", () => {
  it("POST /api/ai/briefing denies another org's campaign id and serves the owner", async () => {
    const request = () =>
      jsonRequest("http://localhost/api/ai/briefing", {
        type: "campaign",
        id: CAMPAIGN_A.id,
      });

    const result = await runRouteTriad({
      handler: postBriefing,
      authMock: mockAuth as any,
      authedSession: sessionA,
      dbMocks: [mockDb.campaign.findFirst],
      resetBeforeScenario: () => {
        jest.clearAllMocks();
        installTenantAwareDb();
        anthropicText("summary text");
      },
      unauthorized: { request },
      crossTenant: {
        foreignSession: sessionB,
        request,
        deniedStatuses: [404],
        assertResponse: async ({ status, body }) => {
          expect(status).toBe(404);
          expect((body as any).error).toBe("Campaign not found");
          expect(serialised(body)).not.toContain(CAMPAIGN_A.title);
          expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ id: CAMPAIGN_A.id, orgId: ORG_B }),
            }),
          );
          expect(mockMessagesCreate).not.toHaveBeenCalled();
        },
      },
      happyPath: {
        request,
        expectedStatuses: [200],
        assertResponse: async ({ body }) => {
          expect((body as any).summary).toBe("summary text");
          expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ id: CAMPAIGN_A.id, orgId: ORG_A }),
            }),
          );
        },
      },
    });

    expect(result.crossTenant?.status).toBe(404);
    expect(result.happyPath.status).toBe(200);
  });

  it("POST /api/ai/nl-query is a list route: foreign org gets 200 with zero rows, never a 403 that could mask a leak", async () => {
    const request = () =>
      jsonRequest("http://localhost/api/ai/nl-query", {
        query: "show me my campaigns",
      });

    await runRouteTriad({
      handler: postNlQuery,
      authMock: mockAuth as any,
      authedSession: sessionA,
      dbMocks: [mockDb.campaign.findMany],
      resetBeforeScenario: () => {
        jest.clearAllMocks();
        installTenantAwareDb();
        anthropicText(JSON.stringify({ type: "list_campaigns" }));
      },
      unauthorized: { request },
      crossTenant: {
        foreignSession: sessionB,
        request,
        assertResponse: async ({ status, body }) => {
          expect(status).toBe(200);
          expect((body as any).count).toBe(0);
          expect((body as any).results).toEqual([]);
          expect(serialised(body)).not.toContain(CAMPAIGN_A.id);
          expect(serialised(body)).not.toContain(CAMPAIGN_A.title);
          expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_B }),
            }),
          );
        },
      },
      happyPath: {
        request,
        expectedStatuses: [200],
        assertResponse: async ({ body }) => {
          expect((body as any).count).toBe(1);
          expect((body as any).results[0].id).toBe(CAMPAIGN_A.id);
          expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_A }),
            }),
          );
        },
      },
    });
  });

  it("GET /api/discovery isolates by org while creator_discovery is entitled for BOTH orgs, so no 403 can be mistaken for tenancy", async () => {
    const request = () =>
      new NextRequest("http://localhost/api/discovery?page=1&limit=20");

    await runRouteTriad({
      handler: getDiscovery,
      authMock: mockAuth as any,
      authedSession: sessionA,
      dbMocks: [mockDb.creator.findMany],
      resetBeforeScenario: () => {
        jest.clearAllMocks();
        installTenantAwareDb();
        mockEntitlements.mockResolvedValue({ features: ["creator_discovery"] });
      },
      unauthorized: { request },
      crossTenant: {
        foreignSession: sessionB,
        request,
        assertResponse: async ({ status, body }) => {
          expect(status).toBe(200);
          expect((body as any).creators).toEqual([]);
          expect((body as any).pagination.total).toBe(0);
          expect(serialised(body)).not.toContain(CREATOR_A.handle);
          expect(mockDb.creator.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_B }),
            }),
          );
        },
      },
      happyPath: {
        request,
        expectedStatuses: [200],
        assertResponse: async ({ body }) => {
          expect((body as any).creators).toHaveLength(1);
          expect((body as any).creators[0].handle).toBe(CREATOR_A.handle);
          expect(mockDb.creator.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_A }),
            }),
          );
        },
      },
    });
  });

  it("POST /api/mcp get_campaign denies another org's real campaign id in the JSON-RPC body over HTTP 200, and serves the owner", async () => {
    const request = () => jsonRpcRequest("get_campaign", { id: CAMPAIGN_A.id });

    await runRouteTriad({
      handler: postMcp,
      authMock: mockAuth as any,
      authedSession: sessionA,
      dbMocks: [mockDb.campaign.findFirst],
      resetBeforeScenario: () => {
        jest.clearAllMocks();
        installTenantAwareDb();
      },
      unauthorized: { request },
      crossTenant: {
        foreignSession: sessionB,
        request,
        assertResponse: async ({ status, body }) => {
          expect(status).toBe(200);
          const payload = mcpToolPayload(body);
          expect(payload.error).toBe("Campaign not found");
          expect(serialised(body)).not.toContain(CAMPAIGN_A.title);
          expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ id: CAMPAIGN_A.id, orgId: ORG_B }),
            }),
          );
        },
      },
      happyPath: {
        request,
        expectedStatuses: [200],
        assertResponse: async ({ body }) => {
          const payload = mcpToolPayload(body);
          expect(payload.error).toBeUndefined();
          expect(payload.title).toBe(CAMPAIGN_A.title);
          expect(mockDb.campaign.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ id: CAMPAIGN_A.id, orgId: ORG_A }),
            }),
          );
        },
      },
    });
  });

  it("POST /api/mcp list_campaigns returns each org only its own campaigns", async () => {
    const request = () => jsonRpcRequest("list_campaigns", {});

    await runRouteTriad({
      handler: postMcp,
      authMock: mockAuth as any,
      authedSession: sessionA,
      dbMocks: [mockDb.campaign.findMany],
      resetBeforeScenario: () => {
        jest.clearAllMocks();
        installTenantAwareDb();
      },
      unauthorized: { request },
      crossTenant: {
        foreignSession: sessionB,
        request,
        assertResponse: async ({ status, body }) => {
          expect(status).toBe(200);
          expect(mcpToolPayload(body)).toEqual([]);
          expect(serialised(body)).not.toContain(CAMPAIGN_A.id);
          expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_B }),
            }),
          );
        },
      },
      happyPath: {
        request,
        expectedStatuses: [200],
        assertResponse: async ({ body }) => {
          const payload = mcpToolPayload(body);
          expect(payload).toHaveLength(1);
          expect(payload[0].id).toBe(CAMPAIGN_A.id);
          expect(mockDb.campaign.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({ orgId: ORG_A }),
            }),
          );
        },
      },
    });
  });

  it("fixture is org-sensitive in both directions: an unscoped where returns nothing, so a dropped orgId filter fails loudly rather than passing empty", async () => {
    expect(await mockDb.campaign.findMany({ where: { orgId: ORG_A } })).toEqual([
      CAMPAIGN_A,
    ]);
    expect(await mockDb.campaign.findMany({ where: { orgId: ORG_B } })).toEqual(
      [],
    );
    expect(await mockDb.campaign.findMany({ where: {} })).toEqual([]);
    expect(
      await mockDb.campaign.findFirst({
        where: { id: CAMPAIGN_A.id, orgId: ORG_B },
      }),
    ).toBeNull();
    expect(
      await mockDb.campaign.findFirst({
        where: { id: CAMPAIGN_A.id, orgId: ORG_A },
      }),
    ).toBe(CAMPAIGN_A);
  });
});
