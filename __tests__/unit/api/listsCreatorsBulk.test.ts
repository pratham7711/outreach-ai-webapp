/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: { findFirst: jest.fn() },
    creator: { findMany: jest.fn() },
    creatorListItem: { createMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ createAuditActor: () => ({}), logAudit: jest.fn() }));

import { POST } from "@/app/api/lists/[id]/creators/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const params = { params: Promise.resolve({ id: "list-1" }) };
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/lists/list-1/creators", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    params
  );

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
  mdb.creatorList.findFirst.mockResolvedValue({ id: "list-1", orgId: "org-1", name: "Editors" });
});

describe("POST /api/lists/[id]/creators, in bulk", () => {
  it("inserts every creator in one createMany and reports duplicates as skipped", async () => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    mdb.creatorListItem.createMany.mockResolvedValue({ count: 2 });
    const res = await post({ creatorIds: ["a", "b", "c", "a"] });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ added: 2, skipped: 1 });
    expect(mdb.creatorListItem.createMany).toHaveBeenCalledTimes(1);
    expect(mdb.creatorListItem.createMany.mock.calls[0][0]).toEqual({
      data: ["a", "b", "c"].map((creatorId) => ({ listId: "list-1", creatorId })),
      skipDuplicates: true,
    });
  });

  it("checks every id against the session's org before writing", async () => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }]);
    const res = await post({ creatorIds: ["a", "other-org"] });
    expect(res.status).toBe(404);
    expect(mdb.creator.findMany.mock.calls[0][0].where).toMatchObject({ orgId: "org-1" });
    expect(mdb.creatorListItem.createMany).not.toHaveBeenCalled();
  });

  it("scopes the list lookup to the session's org", async () => {
    mdb.creatorList.findFirst.mockResolvedValue(null);
    expect((await post({ creatorIds: ["a"] })).status).toBe(404);
    expect(mdb.creatorList.findFirst).toHaveBeenCalledWith({ where: { id: "list-1", orgId: "org-1" } });
  });

  it("rejects an empty or oversized request", async () => {
    expect((await post({ creatorIds: [] })).status).toBe(400);
    expect((await post({ creatorIds: Array.from({ length: 501 }, (_, i) => `c${i}`) })).status).toBe(400);
  });
});
