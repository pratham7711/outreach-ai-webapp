/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/financial-reports/generate/route";

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findUnique: jest.fn() },
    payout: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
    payoutRequest: { findMany: jest.fn() },
    payoutBalance: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

// Mock react-pdf renderToBuffer to avoid heavy rendering in tests
jest.mock("@react-pdf/renderer", () => ({
  renderToBuffer: jest.fn().mockResolvedValue(Buffer.from("%PDF-mock")),
  Document: () => null,
  Page: () => null,
  Text: () => null,
  View: () => null,
  StyleSheet: { create: (s: any) => s },
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1", email: "a@b.com" } };

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/financial-reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.organization.findUnique.mockResolvedValue({ currency: "USD" });
  mockDb.payout.findMany.mockResolvedValue([]);
  mockDb.campaign.findMany.mockResolvedValue([]);
  mockDb.payoutRequest.findMany.mockResolvedValue([]);
  mockDb.payoutBalance.findMany.mockResolvedValue([]);
});

describe("POST /api/financial-reports/generate", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest({ period: "THIS_MONTH", format: "pdf" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid format", async () => {
    const res = await POST(makeRequest({ period: "THIS_MONTH", format: "csv" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/format/i);
  });

  it("returns 400 for invalid period", async () => {
    const res = await POST(makeRequest({ period: "INVALID", format: "pdf" }));
    expect(res.status).toBe(400);
  });

  it("returns PDF with correct Content-Type", async () => {
    const res = await POST(makeRequest({ period: "THIS_MONTH", format: "pdf" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain(".pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("returns XLSX with correct Content-Type", async () => {
    const res = await POST(makeRequest({ period: "THIS_MONTH", format: "xlsx" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.headers.get("Content-Disposition")).toContain(".xlsx");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  /* The export and the screen used to be two independent copies of the period
     maths, and the copies had drifted. These pin the seams that differed. */
  it("orders Top Campaigns by budget within the period, not by createdAt", async () => {
    await POST(makeRequest({ period: "THIS_MONTH", format: "xlsx" }));

    const topCall = mockDb.campaign.findMany.mock.calls.find(
      (c: any[]) => c[0].orderBy?.budget !== undefined
    );
    expect(topCall).toBeDefined();
    expect(topCall[0].orderBy).toEqual({ budget: "desc" });
    // Period-filtered, and campaigns with no budget are excluded rather than
    // led with as "$0.00 / 0%".
    expect(topCall[0].where.budget).toEqual({ not: null });
    expect(topCall[0].where.createdAt).toBeDefined();
    expect(topCall[0].where.deletedAt).toBeNull();
  });

  it("dates a settled payout by completedAt in the trend, as the screen does", async () => {
    await POST(makeRequest({ period: "THIS_MONTH", format: "xlsx" }));

    const trendCall = mockDb.payout.findMany.mock.calls.find(
      (c: any[]) => c[0].select?.completedAt === true
    );
    expect(trendCall).toBeDefined();
  });

  it("drops payouts belonging to a soft-deleted campaign", async () => {
    await POST(makeRequest({ period: "THIS_MONTH", format: "xlsx" }));

    for (const call of mockDb.payout.findMany.mock.calls) {
      expect(call[0].where.OR).toEqual([
        { campaignId: null },
        { campaign: { deletedAt: null } },
      ]);
    }
    expect(mockDb.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ campaign: { deletedAt: null } }),
      })
    );
  });

  it("filters data by orgId from auth result", async () => {
    await POST(makeRequest({ period: "THIS_MONTH", format: "xlsx" }));
    // All db queries should include orgId
    for (const call of mockDb.payout.findMany.mock.calls) {
      expect(call[0].where.orgId).toBe("org-1");
    }
    for (const call of mockDb.campaign.findMany.mock.calls) {
      expect(call[0].where.orgId).toBe("org-1");
    }
    expect(mockDb.payoutRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: "org-1" }) })
    );
  });
});
