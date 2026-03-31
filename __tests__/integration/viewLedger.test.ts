/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import {
  GET as getLedger,
  POST as postLedger,
} from "@/app/api/campaigns/[id]/view-ledger/route";
import { GET as getPayoutCalc } from "@/app/api/campaigns/[id]/payout-calculator/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    activation: { findMany: jest.fn() },
    viewLedger: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    creator: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };
const otherOrgSession = { user: { id: "user-2", orgId: "org-other" } };

const viewBasedCampaign = {
  id: "camp-1",
  orgId: "org-1",
  campaignType: "VIEW_BASED",
  typeConfig: {
    ratePerThousandViews: 2.5,
    capAmount: 5000,
    trackingWindowDays: 30,
    minimumViewsForPayout: 10000,
  },
  budget: 20000,
  deletedAt: null,
};

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue(viewBasedCampaign);
});

// ─── GET /api/campaigns/[id]/view-ledger ─────────────────────────────────────

describe("GET /api/campaigns/[id]/view-ledger", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger");
    const res = await getLedger(req, makeParams("camp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger");
    const res = await getLedger(req, makeParams("camp-1"));
    expect(res.status).toBe(403);
  });

  it("returns grouped ledger entries", async () => {
    const entries = [
      {
        id: "vl-1",
        orgId: "org-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        activationId: "act-1",
        postId: "post-1",
        viewsRecorded: 50000,
        viewsDelta: 50000,
        cpmRate: 2.5,
        amountEarned: 125,
        cumulativeEarned: 125,
        cappedAt: 5000,
        isCapped: false,
        recordedAt: new Date(),
      },
    ];
    mockDb.viewLedger.findMany.mockResolvedValue(entries);

    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger");
    const res = await getLedger(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.creators).toHaveLength(1);
    expect(body.creators[0].creatorId).toBe("cr-1");
    expect(body.creators[0].totalViews).toBe(50000);
    expect(body.creators[0].totalEarned).toBe(125);
  });
});

// ─── POST /api/campaigns/[id]/view-ledger ────────────────────────────────────

describe("POST /api/campaigns/[id]/view-ledger", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger", {
      method: "POST",
    });
    const res = await postLedger(req, makeParams("camp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger", {
      method: "POST",
    });
    const res = await postLedger(req, makeParams("camp-1"));
    expect(res.status).toBe(403);
  });

  it("records ledger entries for activations with posts", async () => {
    mockDb.activation.findMany.mockResolvedValue([
      {
        id: "act-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        posts: [
          { id: "post-1", viewsCount: 50000, activationId: "act-1", creatorId: "cr-1" },
        ],
        creator: { id: "cr-1", name: "Creator 1", handle: "@creator1" },
      },
    ]);

    // No previous entry
    mockDb.viewLedger.findFirst.mockResolvedValue(null);
    mockDb.viewLedger.aggregate.mockResolvedValue({ _sum: { amountEarned: 0 } });

    const createdEntry = {
      id: "vl-new",
      orgId: "org-1",
      campaignId: "camp-1",
      creatorId: "cr-1",
      activationId: "act-1",
      postId: "post-1",
      viewsRecorded: 50000,
      viewsDelta: 50000,
      cpmRate: 2.5,
      amountEarned: 125,
      cumulativeEarned: 125,
      cappedAt: 5000,
      isCapped: false,
    };
    mockDb.viewLedger.create.mockResolvedValue(createdEntry);

    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger", {
      method: "POST",
    });
    const res = await postLedger(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.recorded).toBe(1);
    expect(body.entries).toHaveLength(1);

    // Verify create was called with correct delta calculation
    expect(mockDb.viewLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        viewsDelta: 50000,
        viewsRecorded: 50000,
        cpmRate: 2.5,
        amountEarned: 125,
      }),
    });
  });

  it("caps earnings when cumulative exceeds capAmount", async () => {
    mockDb.activation.findMany.mockResolvedValue([
      {
        id: "act-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        posts: [
          { id: "post-1", viewsCount: 5000000, activationId: "act-1", creatorId: "cr-1" },
        ],
        creator: { id: "cr-1", name: "Creator 1", handle: "@creator1" },
      },
    ]);

    mockDb.viewLedger.findFirst.mockResolvedValue({
      viewsRecorded: 1000000,
    });

    // Already earned 4900
    mockDb.viewLedger.aggregate.mockResolvedValue({ _sum: { amountEarned: 4900 } });

    mockDb.viewLedger.create.mockImplementation(({ data }: any) => Promise.resolve({ id: "vl-cap", ...data }));

    const req = makeRequest("http://localhost/api/campaigns/camp-1/view-ledger", {
      method: "POST",
    });
    const res = await postLedger(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(201);
    // amountEarned should be capped: capAmount(5000) - previousCumulative(4900) = 100
    expect(mockDb.viewLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isCapped: true,
        amountEarned: 100,
      }),
    });
  });
});

// ─── GET /api/campaigns/[id]/payout-calculator ───────────────────────────────

describe("GET /api/campaigns/[id]/payout-calculator", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/payout-calculator");
    const res = await getPayoutCalc(req, makeParams("camp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/payout-calculator");
    const res = await getPayoutCalc(req, makeParams("camp-1"));
    expect(res.status).toBe(403);
  });

  it("returns payout calculations per creator", async () => {
    const entries = [
      {
        id: "vl-1",
        orgId: "org-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        activationId: "act-1",
        postId: "post-1",
        viewsRecorded: 50000,
        viewsDelta: 50000,
        cpmRate: 2.5,
        amountEarned: 125,
        cumulativeEarned: 125,
        cappedAt: 5000,
        isCapped: false,
        recordedAt: new Date(),
      },
      {
        id: "vl-2",
        orgId: "org-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        activationId: "act-1",
        postId: "post-1",
        viewsRecorded: 100000,
        viewsDelta: 50000,
        cpmRate: 2.5,
        amountEarned: 125,
        cumulativeEarned: 250,
        cappedAt: 5000,
        isCapped: false,
        recordedAt: new Date(),
      },
    ];

    mockDb.viewLedger.findMany.mockResolvedValue(entries);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "cr-1", name: "Creator 1", handle: "@creator1", avatarUrl: null },
    ]);

    const req = makeRequest("http://localhost/api/campaigns/camp-1/payout-calculator");
    const res = await getPayoutCalc(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.creators).toHaveLength(1);
    expect(body.creators[0].totalViews).toBe(100000);
    expect(body.creators[0].totalEarned).toBe(250);
    expect(body.campaignTotal).toBe(250);
    expect(body.budget).toBe(20000);
    expect(body.remainingBudget).toBe(19750);
  });
});
