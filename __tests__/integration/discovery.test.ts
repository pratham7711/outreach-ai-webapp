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
