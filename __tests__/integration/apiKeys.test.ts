/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/keys/route";
import { DELETE } from "@/app/api/keys/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
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

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
});

// ─── POST /api/keys ──────────────────────────────────────────────────────────

describe("POST /api/keys", () => {
  it("creates key and returns plaintext key", async () => {
    mockDb.apiKey.create.mockResolvedValue({
      id: "key-1",
      name: "Test Key",
      createdAt: new Date().toISOString(),
    });

    const req = makeRequest("http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "Test Key" }),
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("key-1");
    expect(body.name).toBe("Test Key");
    expect(body.key).toBeDefined();
    expect(body.key).toMatch(/^oai_[a-f0-9]{32}$/);

    // Verify db.create was called with a hashed key
    const createCall = mockDb.apiKey.create.mock.calls[0][0];
    expect(createCall.data.orgId).toBe("org-1");
    expect(createCall.data.name).toBe("Test Key");
    expect(createCall.data.keyHash).toBeDefined();
    expect(createCall.data.keyHash).not.toContain("oai_");
    expect(createCall.data.keyHash).toHaveLength(64); // SHA-256 hex
  });

  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "Test" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects empty name", async () => {
    const req = makeRequest("http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Name is required");
  });

  it("rejects missing name", async () => {
    const req = makeRequest("http://localhost/api/keys", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/keys ───────────────────────────────────────────────────────────

describe("GET /api/keys", () => {
  it("lists keys without hashes", async () => {
    const mockKeys = [
      { id: "key-1", name: "Prod", createdAt: "2026-01-01", lastUsedAt: null },
      { id: "key-2", name: "Dev", createdAt: "2026-02-01", lastUsedAt: "2026-03-01" },
    ];
    mockDb.apiKey.findMany.mockResolvedValue(mockKeys);

    const req = makeRequest("http://localhost/api/keys");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.keys).toHaveLength(2);
    expect(body.keys[0].name).toBe("Prod");
    // Ensure no hash is exposed
    expect(body.keys[0].keyHash).toBeUndefined();

    // Verify the select clause was used
    const findCall = mockDb.apiKey.findMany.mock.calls[0][0];
    expect(findCall.where.orgId).toBe("org-1");
    expect(findCall.select.id).toBe(true);
    expect(findCall.select.name).toBe(true);
  });

  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/keys");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/keys/[id] ───────────────────────────────────────────────────

describe("DELETE /api/keys/[id]", () => {
  it("revokes key belonging to the org", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "key-1",
      orgId: "org-1",
      name: "Test",
    });
    mockDb.apiKey.delete.mockResolvedValue({});

    const req = makeRequest("http://localhost/api/keys/key-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("key-1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDb.apiKey.delete).toHaveBeenCalledWith({ where: { id: "key-1" } });
  });

  it("returns 404 for key belonging to a different org", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "key-2",
      orgId: "org-other",
      name: "Foreign Key",
    });

    const req = makeRequest("http://localhost/api/keys/key-2", { method: "DELETE" });
    const res = await DELETE(req, makeParams("key-2"));

    expect(res.status).toBe(404);
    expect(mockDb.apiKey.delete).not.toHaveBeenCalled();
  });

  it("returns 404 for non-existent key", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(null);

    const req = makeRequest("http://localhost/api/keys/nope", { method: "DELETE" });
    const res = await DELETE(req, makeParams("nope"));

    expect(res.status).toBe(404);
  });

  it("returns 401 without session", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/keys/key-1", { method: "DELETE" });
    const res = await DELETE(req, makeParams("key-1"));
    expect(res.status).toBe(401);
  });
});
