/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    payout: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    organization: {
      findUnique: jest.fn().mockResolvedValue({
        id: "org-1",
        plan: "pro",
        planConfig: null,
        brandName: "Test Org",
        logoUrl: null,
        faviconUrl: null,
        primaryColor: "#5B5BD6",
        secondaryColor: "#fff",
        accentColor: "#fff",
        fontFamily: "Inter",
        uiConfig: null,
      }),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/audit", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
  createAuditActor: jest.fn().mockReturnValue({
    userId: "user-1",
    actorEmail: "admin@demo.com",
    actorType: "user",
  }),
}));

import { POST } from "@/app/api/payouts/bulk/route";
import { PATCH } from "@/app/api/payouts/[id]/route";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const mockAuth = auth as jest.Mock;
const mockLogAudit = logAudit as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1", email: "admin@demo.com" } };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

describe("POST /api/payouts/bulk — audit", () => {
  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/payouts/bulk", {
      method: "POST",
      body: JSON.stringify({ ids: ["p-1"], status: "PROCESSING" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("calls logAudit once per successfully updated payout", async () => {
    const existingPayouts = [
      { id: "p-1", status: "PENDING", orgId: "org-1", transactionId: null },
      { id: "p-2", status: "PENDING", orgId: "org-1", transactionId: null },
    ];
    mockDb.payout.findMany.mockResolvedValue(existingPayouts);
    mockDb.payout.updateMany.mockResolvedValue({ count: 2 });

    const req = new NextRequest("http://localhost/api/payouts/bulk", {
      method: "POST",
      body: JSON.stringify({ ids: ["p-1", "p-2"], status: "PROCESSING" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockLogAudit).toHaveBeenCalledTimes(2);
    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "payout.status_changed",
        entityType: "payout",
        orgId: "org-1",
      })
    );
  });
});

describe("PATCH /api/payouts/[id] — auth", () => {
  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/payouts/p-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "PROCESSING" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "p-1" }) } as any);
    expect(res.status).toBe(401);
  });
});
