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
      create: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({
  auth: jest.fn(),
}));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

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
    mockDb.creatorListItem.create.mockResolvedValue({ id: "item-1", listId: "list-1", creatorId: "creator-1" });

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
