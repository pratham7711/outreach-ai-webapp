/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/financial-reports/generate/route";

jest.mock("@/lib/db", () => ({
  db: {
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
