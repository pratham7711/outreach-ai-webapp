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

const authedSession = { user: { id: "user-1", orgId: "org-1", role: "OWNER" } };
const otherOrgSession = { user: { id: "user-2", orgId: "org-other" } };
const mockCampaign = { id: "camp-1", orgId: "org-1", deletedAt: null };

function makeRequest(url: string, options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue(mockCampaign);
  mockDb.viewFraudFlag.findMany.mockResolvedValue([]);
  mockDb.viewFraudFlag.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `flag-${data.flagType}`, isResolved: false, ...data })
  );
});

function postWithSnapshots(snapshots: any[], overrides: any = {}) {
  const last = snapshots[snapshots.length - 1];
  return {
    id: "post-1",
    campaignId: "camp-1",
    creatorId: "creator-1",
    viewsCount: last.viewsCount,
    likesCount: last.likesCount,
    commentsCount: last.commentsCount,
    sharesCount: last.sharesCount,
    engagementRate: last.engagementRate,
    snapshots,
    ...overrides,
  };
}

function snapshot(
  id: string,
  viewsCount: number,
  likesCount: number,
  commentsCount: number,
  sharesCount: number,
  recordedAt: string
) {
  const interactions = likesCount + commentsCount + sharesCount;
  return {
    id,
    viewsCount,
    likesCount,
    commentsCount,
    sharesCount,
    engagementRate: viewsCount > 0 ? (interactions / viewsCount) * 100 : 0,
    recordedAt: new Date(recordedAt),
  };
}

async function runScan() {
  const req = makeRequest("http://localhost/api/campaigns/camp-1/fraud-scan", {
    method: "POST",
  });
  const res = await fraudScan(req, makeParams("camp-1"));
  return { res, body: await res.json() };
}

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

  it("flags VIEW_SPIKE when a view jump brings no engagement with it", async () => {
    mockDb.post.findMany.mockResolvedValue([
      postWithSnapshots([
        snapshot("snap-1", 1000, 50, 10, 5, "2026-01-01T00:00:00Z"),
        snapshot("snap-2", 9000, 52, 10, 5, "2026-01-02T00:00:00Z"),
      ]),
    ]);

    const { res, body } = await runScan();

    expect(res.status).toBe(200);
    expect(body.flagsCreated).toBe(1);
    expect(body.flags[0].flagType).toBe("VIEW_SPIKE");
    expect(body.flags[0].severity).toBe("MEDIUM");
    expect(body.flags[0].evidence.marginalEngagementRate).toBeCloseTo(0.03, 2);
  });

  it("does not flag an organically viral post whose engagement holds", async () => {
    mockDb.post.findMany.mockResolvedValue([
      postWithSnapshots([
        snapshot("snap-1", 1000, 50, 10, 5, "2026-01-01T00:00:00Z"),
        snapshot("snap-2", 5000, 200, 50, 30, "2026-01-02T00:00:00Z"),
      ]),
    ]);

    const { res, body } = await runScan();

    expect(res.status).toBe(200);
    expect(body.flagsCreated).toBe(0);
    expect(mockDb.viewFraudFlag.create).not.toHaveBeenCalled();
  });

  it("leaves VIEW_SPIKE quiet on a post that was always low-engagement", async () => {
    mockDb.post.findMany.mockResolvedValue([
      postWithSnapshots([
        snapshot("snap-1", 10000, 25, 5, 0, "2026-01-01T00:00:00Z"),
        snapshot("snap-2", 50000, 125, 25, 0, "2026-01-02T00:00:00Z"),
      ]),
    ]);

    const { body } = await runScan();

    expect(body.flags.map((f: any) => f.flagType)).toEqual(["LOW_ENGAGEMENT"]);
  });

  it("does not re-create a flag an earlier scan already raised", async () => {
    mockDb.post.findMany.mockResolvedValue([
      postWithSnapshots([
        snapshot("snap-1", 1000, 50, 10, 5, "2026-01-01T00:00:00Z"),
        snapshot("snap-2", 9000, 52, 10, 5, "2026-01-02T00:00:00Z"),
      ]),
    ]);
    mockDb.viewFraudFlag.findMany.mockResolvedValue([
      {
        postId: "post-1",
        flagType: "VIEW_SPIKE",
        evidence: { snapshotAfterId: "snap-2" },
      },
    ]);

    const { body } = await runScan();

    expect(body.flagsCreated).toBe(0);
    expect(body.flagsSkipped).toBe(1);
    expect(mockDb.viewFraudFlag.create).not.toHaveBeenCalled();
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

  it("blocks a VIEWER from resolving a fraud flag (403, no write)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "viewer-1", orgId: "org-1", role: "VIEWER" } });
    const req = makeRequest("http://localhost/api/fraud-flags/flag-1", {
      method: "PATCH",
      body: JSON.stringify({ isResolved: true }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchFraudFlag(req, makeParams("flag-1"));
    expect(res.status).toBe(403);
    expect(mockDb.viewFraudFlag.update).not.toHaveBeenCalled();
  });
});
