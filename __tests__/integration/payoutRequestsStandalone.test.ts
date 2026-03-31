/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getPayoutRequests } from "@/app/api/payout-requests/route";

jest.mock("@/lib/db", () => ({
  db: {
    payoutRequest: { findMany: jest.fn() },
    creator: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string) {
  return new NextRequest(url);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/payout-requests ───────────────────────────────────────────────

describe("GET /api/payout-requests", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/payout-requests");
    const res = await getPayoutRequests(req);
    expect(res.status).toBe(401);
  });

  it("returns aggregated payout requests with campaign and creator info", async () => {
    mockDb.payoutRequest.findMany.mockResolvedValue([
      {
        id: "pr-1",
        orgId: "org-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        requestedAmount: 500,
        currency: "USD",
        status: "PENDING",
        rejectionReason: null,
        processedAt: null,
        createdAt: new Date("2026-03-29"),
        updatedAt: new Date("2026-03-29"),
        campaign: { id: "camp-1", title: "Summer Campaign" },
      },
      {
        id: "pr-2",
        orgId: "org-1",
        campaignId: "camp-2",
        creatorId: "cr-2",
        requestedAmount: 1000,
        currency: "USD",
        status: "APPROVED",
        rejectionReason: null,
        processedAt: new Date("2026-03-30"),
        createdAt: new Date("2026-03-28"),
        updatedAt: new Date("2026-03-30"),
        campaign: { id: "camp-2", title: "Winter Campaign" },
      },
    ]);

    mockDb.creator.findMany.mockResolvedValue([
      { id: "cr-1", name: "Creator One", handle: "@creator1" },
      { id: "cr-2", name: "Creator Two", handle: "@creator2" },
    ]);

    const req = makeRequest("http://localhost/api/payout-requests");
    const res = await getPayoutRequests(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payoutRequests).toHaveLength(2);
    expect(body.payoutRequests[0].campaignTitle).toBe("Summer Campaign");
    expect(body.payoutRequests[0].creatorName).toBe("Creator One");
    expect(body.payoutRequests[1].status).toBe("APPROVED");
    expect(body.payoutRequests[1].creatorHandle).toBe("@creator2");
  });

  it("filters by status when query param is provided", async () => {
    mockDb.payoutRequest.findMany.mockResolvedValue([
      {
        id: "pr-1",
        orgId: "org-1",
        campaignId: "camp-1",
        creatorId: "cr-1",
        requestedAmount: 500,
        currency: "USD",
        status: "PENDING",
        rejectionReason: null,
        processedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        campaign: { id: "camp-1", title: "Summer Campaign" },
      },
    ]);
    mockDb.creator.findMany.mockResolvedValue([
      { id: "cr-1", name: "Creator One", handle: "@creator1" },
    ]);

    const req = makeRequest(
      "http://localhost/api/payout-requests?status=PENDING"
    );
    const res = await getPayoutRequests(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payoutRequests).toHaveLength(1);

    // Verify the DB was called with the status filter
    expect(mockDb.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1", status: "PENDING" },
      })
    );
  });

  it("ignores invalid status filter values", async () => {
    mockDb.payoutRequest.findMany.mockResolvedValue([]);
    mockDb.creator.findMany.mockResolvedValue([]);

    const req = makeRequest(
      "http://localhost/api/payout-requests?status=INVALID"
    );
    const res = await getPayoutRequests(req);

    expect(res.status).toBe(200);
    // Should NOT include status in the where clause
    expect(mockDb.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1" },
      })
    );
  });
});
