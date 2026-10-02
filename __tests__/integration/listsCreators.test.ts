/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/lists/[id]/creators/route";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: {
      findFirst: jest.fn(),
    },
    creator: {
      findMany: jest.fn(),
    },
    creatorListItem: {
      createMany: jest.fn(),
    },
    creatorListDetail: { findMany: jest.fn() },
    creatorListItemDetail: { groupBy: jest.fn(), upsert: jest.fn(), createMany: jest.fn() },
    creatorListShare: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { listSummaries } from "@/lib/lists/listReview";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1" } });
});

describe("POST /api/lists/[id]/creators", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/lists/list-1/creators", {
      method: "POST",
      body: JSON.stringify({ creatorId: "creator-1" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, makeParams("list-1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when list does not belong to the org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/lists/list-1/creators", {
      method: "POST",
      body: JSON.stringify({ creatorId: "creator-1" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, makeParams("list-1"));
    expect(res.status).toBe(404);
  });

  it("adds creator to list when list and creator belong to the org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue({ id: "list-1", orgId: "org-1", name: "Top Creators" });
    mockDb.creator.findMany.mockResolvedValue([{ id: "creator-1", name: "Alice" }]);
    mockDb.creatorListItem.createMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest("http://localhost/api/lists/list-1/creators", {
      method: "POST",
      body: JSON.stringify({ creatorId: "creator-1" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req, makeParams("list-1"));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.added).toBe(1);
    expect(mockDb.creator.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["creator-1"] }, orgId: "org-1", deletedAt: null },
      select: { id: true, name: true },
    });
  });
});

describe("adding creators to a list under review", () => {
  it("writes no approval rows, and an approved list reads as awaiting the client again", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue({ id: "list-1", orgId: "org-1", name: "Spring pitch" });
    mockDb.creator.findMany.mockResolvedValue([{ id: "creator-9", name: "Fake Nine" }]);
    mockDb.creatorListItem.createMany.mockResolvedValue({ count: 1 });
    const res = await POST(
      new NextRequest("http://localhost/api/lists/list-1/creators", { method: "POST", body: JSON.stringify({ creatorId: "creator-9" }) }),
      makeParams("list-1"),
    );
    expect(res.status).toBe(201);
    // Status is derived on read, so the add itself stays exactly the plain insert.
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
    expect(mockDb.creatorListItemDetail.createMany).not.toHaveBeenCalled();

    // Before: two creators, both decided, one approved. After: a third with no verdict.
    mockDb.creatorListDetail.findMany.mockResolvedValue([]);
    mockDb.creatorListShare.findMany.mockResolvedValue([{ listId: "list-1" }]);
    mockDb.creatorListItemDetail.groupBy.mockResolvedValue([
      { listId: "list-1", decision: "APPROVED", _count: { _all: 1 } },
      { listId: "list-1", decision: "REJECTED", _count: { _all: 1 } },
    ]);
    expect((await listSummaries("org-1", [{ id: "list-1", total: 2 }])).get("list-1")?.status).toBe("APPROVED");
    expect((await listSummaries("org-1", [{ id: "list-1", total: 3 }])).get("list-1")).toMatchObject({
      status: "SHARED",
      counts: { total: 3, approved: 1, rejected: 1, pending: 1 },
    });
  });
});
