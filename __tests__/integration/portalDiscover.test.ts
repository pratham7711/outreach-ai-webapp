/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getDiscover } from "@/app/api/portal/discover/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    campaignProposal: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockDb = db as any;
const mockGetCreatorSession = getCreatorSession as jest.Mock;

const authedSession = { creatorUserId: "cu-1" };

function makeRequest(qs = "") {
  return new NextRequest(`http://localhost/api/portal/discover${qs ? `?${qs}` : ""}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCreatorSession.mockResolvedValue(authedSession);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.campaign.count.mockResolvedValue(0);
  mockDb.campaignProposal.findMany.mockResolvedValue([]);
});

describe("GET /api/portal/discover", () => {
  it("returns 401 when no session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await getDiscover(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns campaigns shape with pagination", async () => {
    mockDb.campaign.count.mockResolvedValue(5);
    const res = await getDiscover(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toHaveProperty("campaigns");
    expect(body).toHaveProperty("pagination");
    expect(body.pagination).toHaveProperty("totalPages");
  });

  describe("fixed filters always present", () => {
    it("always includes enrollmentOpen, visibility, status", async () => {
      await getDiscover(makeRequest());
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.enrollmentOpen).toBe(true);
      expect(call.where.marketplaceVisibility).toBe("PUBLIC");
      expect(call.where.status).toBe("IN_PROGRESS");
    });
  });

  describe("campaignType filter", () => {
    it("does NOT add campaignType when ALL is passed", async () => {
      await getDiscover(makeRequest("campaignType=ALL"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.campaignType).toBeUndefined();
    });

    it("filters by BUDGET_BASED", async () => {
      await getDiscover(makeRequest("campaignType=BUDGET_BASED"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.campaignType).toBe("BUDGET_BASED");
    });

    it("filters by VIEW_BASED", async () => {
      await getDiscover(makeRequest("campaignType=VIEW_BASED"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.campaignType).toBe("VIEW_BASED");
    });
  });

  describe("budget range filter", () => {
    it("applies gte when only minBudget given", async () => {
      await getDiscover(makeRequest("minBudget=500"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.budget).toEqual({ gte: 500 });
    });

    it("applies lte when only maxBudget given", async () => {
      await getDiscover(makeRequest("maxBudget=5000"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.budget).toEqual({ lte: 5000 });
    });

    it("applies both when both given", async () => {
      await getDiscover(makeRequest("minBudget=500&maxBudget=5000"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.budget).toEqual({ gte: 500, lte: 5000 });
    });

    it("does not add budget filter when no range given", async () => {
      await getDiscover(makeRequest());
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.where.budget).toBeUndefined();
    });
  });

  describe("sort", () => {
    it("defaults to newest (createdAt desc)", async () => {
      await getDiscover(makeRequest());
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ createdAt: "desc" });
    });

    it("budget_desc → orderBy budget desc", async () => {
      await getDiscover(makeRequest("sort=budget_desc"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ budget: "desc" });
    });

    it("budget_asc → orderBy budget asc", async () => {
      await getDiscover(makeRequest("sort=budget_asc"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ budget: "asc" });
    });

    it("proposals_desc → orderBy proposals _count desc", async () => {
      await getDiscover(makeRequest("sort=proposals_desc"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.orderBy).toEqual({ proposals: { _count: "desc" } });
    });
  });

  describe("pagination", () => {
    it("applies correct skip for page 2 limit 5", async () => {
      await getDiscover(makeRequest("page=2&limit=5"));
      const call = mockDb.campaign.findMany.mock.calls[0][0];
      expect(call.skip).toBe(5);
      expect(call.take).toBe(5);
    });

    it("response includes pagination.totalPages", async () => {
      mockDb.campaign.count.mockResolvedValue(40);
      const res = await getDiscover(makeRequest("limit=10"));
      const body = await res.json();
      expect(body.pagination.totalPages).toBe(4);
    });
  });

  describe("alreadyProposed enrichment", () => {
    it("marks campaigns the creator has already proposed to", async () => {
      const campaign = { id: "camp-1", title: "Test", campaignType: "BUDGET_BASED", typeConfig: null, budget: 1000, currency: "USD", thumbnailUrl: null, notes: null, enrollmentOpen: true, createdAt: new Date(), org: { id: "org-1", name: "Test Org", logoUrl: null }, _count: { activations: 0, posts: 0, proposals: 0 } };
      mockDb.campaign.findMany.mockResolvedValue([campaign]);
      mockDb.campaign.count.mockResolvedValue(1);
      mockDb.campaignProposal.findMany.mockResolvedValue([{ campaignId: "camp-1" }]);

      const res = await getDiscover(makeRequest());
      const body = await res.json();
      expect(body.campaigns[0].alreadyProposed).toBe(true);
    });
  });
});
