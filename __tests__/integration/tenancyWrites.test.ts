/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST as activationsPOST } from "@/app/api/activations/route";
import { POST as payoutsPOST } from "@/app/api/payouts/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creator: { findFirst: jest.fn() },
    activation: { create: jest.fn() },
    payout: { create: jest.fn() },
  },
}));

jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: jest.fn(() => ({ actorType: "USER", actorUserId: "u1", actorEmail: "a@b.com" })),
}));

jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

function jsonReq(url: string, payload: unknown) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(payload) });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u1", actorEmail: "a@b.com", actorType: "USER" });
});

describe("POST /api/activations — creator tenancy", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await activationsPOST(jsonReq("http://localhost/api/activations", { campaignId: "c", creatorId: "x" }));
    expect(res.status).toBe(401);
  });

  it("rejects a creator that does not belong to the org (404, no write)", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", orgId: "org-1" });
    mockDb.creator.findFirst.mockResolvedValue(null);

    const res = await activationsPOST(
      jsonReq("http://localhost/api/activations", { campaignId: "camp-1", creatorId: "foreign-creator" })
    );

    expect(res.status).toBe(404);
    expect(mockDb.activation.create).not.toHaveBeenCalled();
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-creator", orgId: "org-1", deletedAt: null },
    });
  });

  it("creates an activation when the creator belongs to the org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", orgId: "org-1" });
    mockDb.creator.findFirst.mockResolvedValue({ id: "c1", orgId: "org-1" });
    mockDb.activation.create.mockResolvedValue({
      id: "act-1",
      campaignId: "camp-1",
      creatorId: "c1",
      status: "AWAITING_DRAFT",
    });

    const res = await activationsPOST(
      jsonReq("http://localhost/api/activations", { campaignId: "camp-1", creatorId: "c1" })
    );

    expect(res.status).toBe(201);
    expect(mockDb.activation.create).toHaveBeenCalled();
  });
});

describe("POST /api/payouts — tenancy and amount validation", () => {
  it("rejects a non-positive amount (400, no write)", async () => {
    const res = await payoutsPOST(jsonReq("http://localhost/api/payouts", { creatorId: "c1", amount: -5 }));
    expect(res.status).toBe(400);
    expect(mockDb.payout.create).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount (400)", async () => {
    const res = await payoutsPOST(jsonReq("http://localhost/api/payouts", { creatorId: "c1", amount: "lots" }));
    expect(res.status).toBe(400);
  });

  it("rejects a zero amount (400)", async () => {
    const res = await payoutsPOST(jsonReq("http://localhost/api/payouts", { creatorId: "c1", amount: 0 }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid currency (400)", async () => {
    const res = await payoutsPOST(
      jsonReq("http://localhost/api/payouts", { creatorId: "c1", amount: 100, currency: "XYZ" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a creator from another org (404, no write)", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await payoutsPOST(jsonReq("http://localhost/api/payouts", { creatorId: "foreign", amount: 100 }));
    expect(res.status).toBe(404);
    expect(mockDb.payout.create).not.toHaveBeenCalled();
  });

  it("creates a payout for a valid in-org creator", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "c1", orgId: "org-1" });
    mockDb.payout.create.mockResolvedValue({
      id: "p1",
      creatorId: "c1",
      campaignId: null,
      amount: 100,
      status: "PENDING",
      transactionId: null,
    });

    const res = await payoutsPOST(jsonReq("http://localhost/api/payouts", { creatorId: "c1", amount: 100 }));
    expect(res.status).toBe(201);
    expect(mockDb.payout.create).toHaveBeenCalled();
    const arg = mockDb.payout.create.mock.calls[0][0];
    expect(arg.data.orgId).toBe("org-1");
    expect(arg.data.amount).toBe(100);
  });
});
