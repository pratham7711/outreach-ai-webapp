/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/recipients/route";
import { runRouteTriad } from "../helpers/routeTriad";

jest.mock("@/lib/db", () => ({
  db: { payout: { findMany: jest.fn() } },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const url = "http://localhost/api/recipients";

const samplePayouts = [
  {
    creatorId: "c1",
    amount: 300,
    status: "SUCCESS",
    paymentMethod: "PAYPAL",
    recipientPaypalEmail: "alice@pay.me",
    completedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    creator: { name: "Alice", handle: "alice", platform: "TIKTOK" },
  },
  {
    creatorId: "c1",
    amount: 50,
    status: "PENDING",
    paymentMethod: "PAYPAL",
    recipientPaypalEmail: null,
    completedAt: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    creator: { name: "Alice", handle: "alice", platform: "TIKTOK" },
  },
  {
    creatorId: "c2",
    amount: 100,
    status: "SUCCESS",
    paymentMethod: "BANK_TRANSFER",
    recipientPaypalEmail: null,
    completedAt: new Date("2026-01-15T00:00:00.000Z"),
    createdAt: new Date("2026-01-10T00:00:00.000Z"),
    creator: { name: "Bob", handle: "bob", platform: "INSTAGRAM" },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
  mockDb.payout.findMany.mockResolvedValue(samplePayouts);
});

describe("GET /api/recipients", () => {
  it("passes the route security triad", async () => {
    await runRouteTriad({
      handler: GET,
      authMock: mockAuth,
      authedSession: { user: { id: "u1", orgId: "org-1" } },
      dbMocks: [mockDb.payout.findMany],
      unauthorized: { request: () => new NextRequest(url) },
      crossTenant: {
        foreignSession: { user: { id: "u2", orgId: "org-2" } },
        request: () => new NextRequest(url),
        assertResponse: () => {
          expect(mockDb.payout.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ orgId: "org-2" }) }),
          );
        },
      },
      happyPath: { request: () => new NextRequest(url) },
    });
  });

  it("aggregates payouts into recipients scoped to the caller's org", async () => {
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockDb.payout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1" } }),
    );

    expect(body.recipients).toHaveLength(2);
    const alice = body.recipients[0];
    expect(alice.name).toBe("Alice");
    expect(alice.totalPaid).toBe(300);
    expect(alice.pending).toBe(50);
    expect(alice.paymentMethods).toEqual(["PAYPAL"]);
    expect(alice.paypalEmail).toBe("alice@pay.me");
    expect(alice.payoutCount).toBe(2);
    expect(alice.lastPayoutAt).toBe("2026-03-01T00:00:00.000Z");

    expect(body.stats.recipientCount).toBe(2);
    expect(body.stats.totalPaid).toBe(400);
    expect(body.stats.totalPending).toBe(50);
  });

  it("returns empty results when the org has no payouts", async () => {
    mockDb.payout.findMany.mockResolvedValue([]);
    const res = await GET(new NextRequest(url));
    const body = await res.json();
    expect(body.recipients).toEqual([]);
    expect(body.stats).toEqual({ recipientCount: 0, totalPaid: 0, totalPending: 0, totalFailed: 0 });
  });
});
