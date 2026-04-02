/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/discovery/route";

jest.mock("@/lib/db", () => ({
  db: {
    creator: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

jest.mock("@/lib/entitlements", () => ({
  ...jest.requireActual("@/lib/entitlements"),
  getOrgEntitlements: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const mockGetOrgEntitlements = getOrgEntitlements as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
  mockGetOrgEntitlements.mockResolvedValue({ featureMap: { creator_discovery: true } });
});

describe("GET /api/discovery", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/discovery"));
    expect(res.status).toBe(401);
  });

  it("returns 403 when creator_discovery is disabled", async () => {
    mockGetOrgEntitlements.mockResolvedValue({ featureMap: { creator_discovery: false } });
    const res = await GET(new NextRequest("http://localhost/api/discovery"));
    expect(res.status).toBe(403);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });

  it("returns creators when feature is enabled", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);
    const res = await GET(new NextRequest("http://localhost/api/discovery"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("creators");
  });
});

describe("niche filter", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);
  });

  it("applies hasSome filter for single niche", async () => {
    const res = await GET(new NextRequest("http://localhost/api/discovery?niches=MUSIC"));
    expect(res.status).toBe(200);
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.niches).toEqual({ hasSome: ["MUSIC"] });
  });

  it("applies hasSome filter for multiple niches", async () => {
    const res = await GET(new NextRequest("http://localhost/api/discovery?niches=MUSIC,FASHION"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.niches).toEqual({ hasSome: ["MUSIC", "FASHION"] });
  });

  it("does not add niches filter when param is empty", async () => {
    const res = await GET(new NextRequest("http://localhost/api/discovery"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.niches).toBeUndefined();
  });
});

describe("follower range filter", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);
  });

  it("applies gte when only minFollowers given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?minFollowers=10000"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.followersCount).toEqual({ gte: 10000 });
  });

  it("applies lte when only maxFollowers given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?maxFollowers=500000"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.followersCount).toEqual({ lte: 500000 });
  });

  it("applies both gte and lte when both given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?minFollowers=10000&maxFollowers=500000"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.followersCount).toEqual({ gte: 10000, lte: 500000 });
  });

  it("does not add followersCount filter when no range given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.followersCount).toBeUndefined();
  });
});

describe("rate range filter", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);
  });

  it("applies gte when only minRate given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?minRate=100"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.rate).toEqual({ gte: 100 });
  });

  it("applies lte when only maxRate given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?maxRate=2000"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.rate).toEqual({ lte: 2000 });
  });

  it("does not add rate filter when no range given", async () => {
    await GET(new NextRequest("http://localhost/api/discovery"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.rate).toBeUndefined();
  });
});

describe("case-insensitive search", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(0);
  });

  it("uses mode insensitive for name and handle search", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?search=alice"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.where.OR[0]).toEqual({ name: { contains: "alice", mode: "insensitive" } });
    expect(call.where.OR[1]).toEqual({ handle: { contains: "alice", mode: "insensitive" } });
  });
});

describe("pagination", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creator.count.mockResolvedValue(50);
  });

  it("applies correct skip for page 2 with limit 5", async () => {
    await GET(new NextRequest("http://localhost/api/discovery?page=2&limit=5"));
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.skip).toBe(5);
    expect(call.take).toBe(5);
  });

  it("response includes pagination.totalPages", async () => {
    const res = await GET(new NextRequest("http://localhost/api/discovery?limit=10"));
    const body = await res.json();
    expect(body.pagination.totalPages).toBe(5); // 50 / 10
  });
});
