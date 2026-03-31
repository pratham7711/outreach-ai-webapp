/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as fraudScan } from "@/app/api/campaigns/[id]/fraud-scan/route";
import { GET as getFraudFlags } from "@/app/api/campaigns/[id]/fraud-flags/route";
import { PATCH as patchFraudFlag } from "@/app/api/fraud-flags/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
    viewFraudFlag: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };
const otherOrgSession = { user: { id: "user-2", orgId: "org-other" } };
const mockCampaign = { id: "camp-1", orgId: "org-1", deletedAt: null };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
});

// ── POST /api/campaigns/[id]/fraud-scan ──────────────────────────────────────

describe("POST /api/campaigns/[id]/fraud-scan", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-scan", {
      method: "POST",
    });
    const res = await fraudScan(req, makeParams("camp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 if campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-scan", {
      method: "POST",
    });
    const res = await fraudScan(req, makeParams("camp-1"));
    expect(res.status).toBe(403);
  });

  it("detects VIEW_SPIKE when snapshots show >300% jump", async () => {
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        campaignId: "camp-1",
        creatorId: "creator-1",
        viewsCount: 5000,
        likesCount: 200,
        commentsCount: 50,
        sharesCount: 30,
        engagementRate: 5.6,
        snapshots: [
          {
            id: "snap-1",
            viewsCount: 1000,
            likesCount: 50,
            commentsCount: 10,
            sharesCount: 5,
            engagementRate: 6.5,
            recordedAt: new Date("2026-01-01T00:00:00Z"),
          },
          {
            id: "snap-2",
            viewsCount: 5000,
            likesCount: 200,
            commentsCount: 50,
            sharesCount: 30,
            engagementRate: 5.6,
            recordedAt: new Date("2026-01-02T00:00:00Z"),
          },
        ],
      },
    ]);

    const createdFlag = {
      id: "flag-1",
      orgId: "org-1",
      campaignId: "camp-1",
      creatorId: "creator-1",
      postId: "post-1",
      flagType: "VIEW_SPIKE",
      severity: "MEDIUM",
      description: "Views increased by 400% between snapshots (1000 -> 5000)",
      evidence: {},
      isResolved: false,
    };
    mockDb.viewFraudFlag.create.mockResolvedValue(createdFlag);

    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-scan", {
      method: "POST",
    });
    const res = await fraudScan(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flagsCreated).toBe(1);
    expect(body.flags).toHaveLength(1);
    expect(body.flags[0].flagType).toBe("VIEW_SPIKE");
  });
});

// ── GET /api/campaigns/[id]/fraud-flags ──────────────────────────────────────

describe("GET /api/campaigns/[id]/fraud-flags", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-flags");
    const res = await getFraudFlags(req, makeParams("camp-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 if campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-flags");
    const res = await getFraudFlags(req, makeParams("camp-1"));
    expect(res.status).toBe(403);
  });

  it("returns fraud flags for campaign", async () => {
    const mockFlags = [
      { id: "flag-1", flagType: "VIEW_SPIKE", severity: "MEDIUM", isResolved: false },
    ];
    mockDb.viewFraudFlag.findMany.mockResolvedValue(mockFlags);

    const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-flags");
    const res = await getFraudFlags(req, makeParams("camp-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.flags).toEqual(mockFlags);
  });
});

// ── PATCH /api/fraud-flags/[id] ──────────────────────────────────────────────

describe("PATCH /api/fraud-flags/[id]", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/fraud-flags/flag-1", {
      method: "PATCH",
      body: JSON.stringify({ isResolved: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchFraudFlag(req, makeParams("flag-1"));
    expect(res.status).toBe(401);
  });

  it("resolves a fraud flag", async () => {
    mockDb.viewFraudFlag.findFirst.mockResolvedValue({
      id: "flag-1",
      orgId: "org-1",
      isResolved: false,
    });
    const updated = {
      id: "flag-1",
      orgId: "org-1",
      isResolved: true,
      resolvedBy: "user-1",
    };
    mockDb.viewFraudFlag.update.mockResolvedValue(updated);

    const req = makeRequest("http://localhost/api/fraud-flags/flag-1", {
      method: "PATCH",
      body: JSON.stringify({ isResolved: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchFraudFlag(req, makeParams("flag-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isResolved).toBe(true);
    expect(body.resolvedBy).toBe("user-1");
  });
});
