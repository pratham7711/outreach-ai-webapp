/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "@/app/api/creators/[id]/social-accounts/route";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: jest.fn() },
    creatorSocialAccount: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };
const fakeCreator = { id: "cr-1", orgId: "org-1", deletedAt: null };

function makeRequest(url: string, options?: RequestInit) {
  return new NextRequest(url, options);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.creator.findFirst.mockResolvedValue(fakeCreator);
});

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/creators/[id]/social-accounts", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts"),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when creator not in org", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await GET(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts"),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 with accounts list", async () => {
    const accounts = [
      {
        id: "sa-1",
        platform: "TIKTOK",
        handle: "@creator",
        followersCount: 10000,
        avgViews: 5000,
        tokenExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    mockDb.creatorSocialAccount.findMany.mockResolvedValue(accounts);
    const res = await GET(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts"),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].platform).toBe("TIKTOK");
  });

  it("does NOT include accessToken in response", async () => {
    const accounts = [
      {
        id: "sa-1",
        platform: "INSTAGRAM",
        handle: "@test",
        followersCount: 0,
        avgViews: 0,
        tokenExpiry: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
    mockDb.creatorSocialAccount.findMany.mockResolvedValue(accounts);
    const res = await GET(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts"),
      makeParams("cr-1"),
    );
    const data = await res.json();
    expect(data[0]).not.toHaveProperty("accessToken");
    expect(data[0]).not.toHaveProperty("refreshToken");
  });
});

// ─── POST ────────────────────────────────────────────────────────────────────

describe("POST /api/creators/[id]/social-accounts", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", {
        method: "POST",
        body: JSON.stringify({ platform: "TIKTOK", handle: "@test" }),
      }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when creator not in org", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await POST(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", {
        method: "POST",
        body: JSON.stringify({ platform: "TIKTOK", handle: "@test" }),
      }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", {
        method: "POST",
        body: JSON.stringify({ platform: "INVALID", handle: "" }),
      }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 and creates account (secrets stripped)", async () => {
    const created = {
      id: "sa-new",
      creatorId: "cr-1",
      platform: "YOUTUBE",
      handle: "@yt",
      accessToken: "secret-tok",
      refreshToken: "secret-ref",
      followersCount: 1000,
      avgViews: 500,
      tokenExpiry: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockDb.creatorSocialAccount.create.mockResolvedValue(created);
    const res = await POST(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", {
        method: "POST",
        body: JSON.stringify({ platform: "YOUTUBE", handle: "@yt", followersCount: 1000, avgViews: 500 }),
      }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.platform).toBe("YOUTUBE");
    expect(data).not.toHaveProperty("accessToken");
    expect(data).not.toHaveProperty("refreshToken");
  });

  it("returns 409 on duplicate platform", async () => {
    mockDb.creatorSocialAccount.create.mockRejectedValue({ code: "P2002" });
    const res = await POST(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", {
        method: "POST",
        body: JSON.stringify({ platform: "TIKTOK", handle: "@dup" }),
      }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(409);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe("DELETE /api/creators/[id]/social-accounts", () => {
  it("returns 401 when no session", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts?accountId=sa-1", { method: "DELETE" }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 when creator not in org", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await DELETE(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts?accountId=sa-1", { method: "DELETE" }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when no accountId provided", async () => {
    const res = await DELETE(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts", { method: "DELETE" }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when account not found", async () => {
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue(null);
    const res = await DELETE(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts?accountId=nope", { method: "DELETE" }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 200 on successful delete", async () => {
    mockDb.creatorSocialAccount.findFirst.mockResolvedValue({ id: "sa-1", creatorId: "cr-1" });
    mockDb.creatorSocialAccount.delete.mockResolvedValue({});
    const res = await DELETE(
      makeRequest("http://localhost/api/creators/cr-1/social-accounts?accountId=sa-1", { method: "DELETE" }),
      makeParams("cr-1"),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });
});
