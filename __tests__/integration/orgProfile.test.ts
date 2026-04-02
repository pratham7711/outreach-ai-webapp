/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getOrg, PATCH as patchOrg } from "@/app/api/org/route";

jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({
  createAuditActor: jest.fn(() => ({})),
  logAudit: jest.fn(),
}));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

const sampleOrg = {
  id: "org-1",
  name: "Demo Org",
  subdomain: "demo",
  brandName: null,
  timezone: "UTC",
  currency: "USD",
  plan: "starter",
  planExpiresAt: null,
  logoUrl: null,
  faviconUrl: null,
  customDomain: null,
  primaryColor: "#5B5BD6",
  secondaryColor: "#1E1B4B",
  accentColor: "#F59E0B",
  fontFamily: "Inter",
  bankAccountName: null,
  bankAccountNumber: null,
  bankIFSC: null,
  bankSwift: null,
  bankRoutingNumber: null,
  createdAt: new Date("2026-01-01"),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/org ─────────────────────────────────────────────────────────────

describe("GET /api/org", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getOrg();
    expect(res.status).toBe(401);
  });

  it("returns org data for authenticated user", async () => {
    mockDb.organization.findUnique.mockResolvedValue(sampleOrg);
    const res = await getOrg();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("org-1");
    expect(body.name).toBe("Demo Org");
    expect(body.subdomain).toBe("demo");
    expect(mockDb.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } })
    );
  });

  it("returns 404 when org not found", async () => {
    mockDb.organization.findUnique.mockResolvedValue(null);
    const res = await getOrg();
    expect(res.status).toBe(404);
  });
});

// ─── PATCH /api/org ───────────────────────────────────────────────────────────

function makePatch(body: object) {
  return new NextRequest("http://localhost/api/org", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/org", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makePatch({ name: "New Name" });
    const res = await patchOrg(req);
    expect(res.status).toBe(401);
  });

  it("updates name and returns updated org", async () => {
    mockDb.organization.findUnique.mockResolvedValue(sampleOrg);
    mockDb.organization.update.mockResolvedValue({ ...sampleOrg, name: "New Name" });

    const req = makePatch({ name: "New Name" });
    const res = await patchOrg(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("New Name");
    expect(mockDb.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } })
    );
  });

  it("returns 400 for invalid color hex", async () => {
    mockDb.organization.findUnique.mockResolvedValue(sampleOrg);
    const req = makePatch({ primaryColor: "not-a-color", currency: "AUD" });
    const res = await patchOrg(req);
    expect(res.status).toBe(400);
  });

  it("accepts null to clear optional fields", async () => {
    mockDb.organization.findUnique.mockResolvedValue(sampleOrg);
    mockDb.organization.update.mockResolvedValue({ ...sampleOrg, brandName: null, logoUrl: null });

    const req = makePatch({ brandName: null, logoUrl: null });
    const res = await patchOrg(req);
    expect(res.status).toBe(200);

    const updateCall = mockDb.organization.update.mock.calls[0][0];
    expect(updateCall.data.brandName).toBeNull();
    expect(updateCall.data.logoUrl).toBeNull();
  });

  it("returns 409 on custom domain conflict (P2002)", async () => {
    mockDb.organization.findUnique.mockResolvedValue(sampleOrg);
    const err: any = new Error("Unique constraint");
    err.code = "P2002";
    mockDb.organization.update.mockRejectedValue(err);

    const req = makePatch({ customDomain: "taken.com" });
    const res = await patchOrg(req);
    expect(res.status).toBe(409);
  });
});
