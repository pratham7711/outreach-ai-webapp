/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/connections/route";

jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── GET /api/connections ─────────────────────────────────────────────────────

describe("GET /api/connections", () => {
  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns all platforms with defaults when no connections stored", async () => {
    mockDb.organization.findUnique.mockResolvedValue({ uiConfig: null });
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(8);
    expect(body[0].platform).toBe("TIKTOK");
    expect(body[0].connected).toBe(false);
    expect(body[0].connectedAt).toBeNull();
    expect(body[0].accountName).toBeNull();
  });

  it("merges stored connection data into platform list", async () => {
    mockDb.organization.findUnique.mockResolvedValue({
      uiConfig: {
        platformConnections: {
          TIKTOK: { connected: true, connectedAt: "2026-03-15T00:00:00Z", accountName: "@brand" },
          STRIPE: { connected: true, connectedAt: "2026-02-01T00:00:00Z", accountName: "acct_123" },
        },
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    const tiktok = body.find((p: any) => p.platform === "TIKTOK");
    expect(tiktok.connected).toBe(true);
    expect(tiktok.accountName).toBe("@brand");
    expect(tiktok.connectedAt).toBe("2026-03-15T00:00:00Z");

    const instagram = body.find((p: any) => p.platform === "INSTAGRAM");
    expect(instagram.connected).toBe(false);

    const stripe = body.find((p: any) => p.platform === "STRIPE");
    expect(stripe.connected).toBe(true);
    expect(stripe.accountName).toBe("acct_123");
  });
});

// ─── POST /api/connections ────────────────────────────────────────────────────

describe("POST /api/connections", () => {
  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ platform: "TIKTOK" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when platform is missing", async () => {
    const req = makeRequest("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("connects a platform and updates uiConfig", async () => {
    mockDb.organization.findUnique.mockResolvedValue({ uiConfig: { someOtherKey: true } });
    mockDb.organization.update.mockResolvedValue({});

    const req = makeRequest("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ platform: "TIKTOK", accountName: "@myaccount" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const updateCall = mockDb.organization.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("org-1");
    expect(updateCall.data.uiConfig.someOtherKey).toBe(true);
    expect(updateCall.data.uiConfig.platformConnections.TIKTOK.connected).toBe(true);
    expect(updateCall.data.uiConfig.platformConnections.TIKTOK.accountName).toBe("@myaccount");
    expect(updateCall.data.uiConfig.platformConnections.TIKTOK.connectedAt).toBeDefined();
  });

  it("connects without accountName", async () => {
    mockDb.organization.findUnique.mockResolvedValue({ uiConfig: null });
    mockDb.organization.update.mockResolvedValue({});

    const req = makeRequest("http://localhost/api/connections", {
      method: "POST",
      body: JSON.stringify({ platform: "YOUTUBE" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const updateCall = mockDb.organization.update.mock.calls[0][0];
    expect(updateCall.data.uiConfig.platformConnections.YOUTUBE.accountName).toBeNull();
  });
});

// ─── DELETE /api/connections ──────────────────────────────────────────────────

describe("DELETE /api/connections", () => {
  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/connections?platform=TIKTOK", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when platform param is missing", async () => {
    const req = makeRequest("http://localhost/api/connections", { method: "DELETE" });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it("disconnects a platform and removes it from uiConfig", async () => {
    mockDb.organization.findUnique.mockResolvedValue({
      uiConfig: {
        platformConnections: {
          TIKTOK: { connected: true, connectedAt: "2026-03-15T00:00:00Z", accountName: "@brand" },
          STRIPE: { connected: true, connectedAt: "2026-02-01T00:00:00Z", accountName: "acct_123" },
        },
      },
    });
    mockDb.organization.update.mockResolvedValue({});

    const req = makeRequest("http://localhost/api/connections?platform=TIKTOK", { method: "DELETE" });
    const res = await DELETE(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const updateCall = mockDb.organization.update.mock.calls[0][0];
    expect(updateCall.where.id).toBe("org-1");
    // TIKTOK should be removed
    expect(updateCall.data.uiConfig.platformConnections.TIKTOK).toBeUndefined();
    // STRIPE should remain
    expect(updateCall.data.uiConfig.platformConnections.STRIPE.connected).toBe(true);
  });
});
