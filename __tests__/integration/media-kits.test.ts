/**
 * @jest-environment node
 *
 * Integration tests for GET/POST /api/media-kits
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/media-kits/route";

jest.mock("@/lib/db", () => ({
  db: {
    mediaKit: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
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
  mockDb.mediaKit.findUnique.mockResolvedValue(null);
});

// ─── GET /api/media-kits ──────────────────────────────────────────────────────

describe("GET /api/media-kits", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns array of media kits for the org", async () => {
    const mockKits = [
      {
        id: "kit-1",
        orgId: "org-1",
        title: "Q1 Creator Kit",
        slug: "q1-creator-kit",
        shareToken: "tok-1",
        isPublic: true,
        creatorIds: ["c1", "c2"],
        config: {},
        createdAt: new Date().toISOString(),
      },
    ];
    mockDb.mediaKit.findMany.mockResolvedValue(mockKits);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(mockKits);
  });

  it("scopes query to authenticated org only", async () => {
    mockDb.mediaKit.findMany.mockResolvedValue([]);

    await GET();

    const callArgs = mockDb.mediaKit.findMany.mock.calls[0][0];
    expect(callArgs.where.orgId).toBe("org-1");
  });

  it("returns empty array when org has no media kits", async () => {
    mockDb.mediaKit.findMany.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("orders results by createdAt descending", async () => {
    mockDb.mediaKit.findMany.mockResolvedValue([]);

    await GET();

    expect(mockDb.mediaKit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

// ─── POST /api/media-kits ─────────────────────────────────────────────────────

describe("POST /api/media-kits", () => {
  const createdKit = {
    id: "kit-new",
    orgId: "org-1",
    title: "Summer Creators",
    slug: "summer-creators",
    shareToken: "unique-token-456",
    isPublic: false,
    creatorIds: ["creator-1", "creator-2"],
    config: {},
    createdById: "user-1",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockDb.mediaKit.create.mockResolvedValue(createdKit);
  });

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Test Kit", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("creates a media kit and returns 201", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Summer Creators", creatorIds: ["creator-1", "creator-2"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.title).toBe("Summer Creators");
  });

  it("returns 400 when title is missing", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ creatorIds: ["c1"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/title/i);
  });

  it("returns 400 when title is empty string", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("scopes the new kit to the authenticated org", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "New Kit", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(mockDb.mediaKit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: "org-1" }),
      })
    );
  });

  it("records createdById from session user", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "My Kit", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.createdById).toBe("user-1");
  });

  it("auto-generates slug from title", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Top Summer Creators", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.slug).toBe("top-summer-creators");
  });

  it("increments slug when slug is already taken", async () => {
    mockDb.mediaKit.findUnique
      .mockResolvedValueOnce({ id: "existing" }) // "my-kit" taken
      .mockResolvedValueOnce(null);               // "my-kit-1" free

    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "My Kit", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.slug).toBe("my-kit-1");
  });

  it("stores creatorIds in the kit", async () => {
    const creatorIds = ["creator-a", "creator-b", "creator-c"];
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Creator Kit", creatorIds }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.creatorIds).toEqual(creatorIds);
  });

  it("defaults creatorIds to empty array when not provided", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Empty Kit" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.creatorIds).toEqual([]);
  });

  it("stores custom config when provided", async () => {
    const customConfig = { layout: "grid", sections: ["bio", "stats", "rates"] };
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Custom Kit", creatorIds: [], config: customConfig }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.config).toEqual(customConfig);
  });

  it("defaults config to empty object when not provided", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Bare Kit", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    expect(callArgs.data.config).toEqual({});
  });

  it("strips special characters from slug", async () => {
    const req = makeRequest("http://localhost/api/media-kits", {
      method: "POST",
      body: JSON.stringify({ title: "Creators: Top 10! (Q1)", creatorIds: [] }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    const callArgs = mockDb.mediaKit.create.mock.calls[0][0];
    // Should only contain lowercase alphanumerics and hyphens
    expect(callArgs.data.slug).toMatch(/^[a-z0-9-]+$/);
    expect(callArgs.data.slug).not.toContain(":");
    expect(callArgs.data.slug).not.toContain("!");
  });
});
