/**
 * @jest-environment node
 *
 * Deleting creators from the roster: one from their profile, or the ticked
 * rows from the roster's bulk bar. A soft delete scoped to the caller's org,
 * gated on creators:delete, that also frees the creator's profile links so the
 * same account can be added again.
 */
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/creators/[id]/route";
import { POST as BULK_DELETE } from "@/app/api/creators/delete/route";

/* eslint-disable @typescript-eslint/no-explicit-any -- jest mocks of the Prisma client, as in the sibling suites */
jest.mock("@/lib/db", () => {
  const db: any = {
    creator: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    creatorProfileLink: { deleteMany: jest.fn() },
    creatorListItem: { deleteMany: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { ROSTER_TABLES } from "@/lib/creators/rosterSchemaDdl";
import { resetRosterTablesCache } from "@/lib/creators/rosterTables";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;
const session = (role: string) => ({ user: { id: "user-1", orgId: "org-1", role } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(new NextRequest(`http://localhost/api/creators/${id}`, { method: "DELETE" }), params(id));
const bulk = (body: unknown) =>
  BULK_DELETE(
    new NextRequest("http://localhost/api/creators/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const row = (id: string) => ({ id, name: `Name ${id}`, handle: `@${id}`, platform: "TIKTOK", creatorUserId: null });

beforeEach(() => {
  jest.clearAllMocks();
  resetRosterTablesCache();
  mockAuth.mockResolvedValue(session("OWNER"));
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: ROSTER_TABLES.length }]);
  mockDb.creator.findFirst.mockResolvedValue({ _count: { activations: 2, posts: 5 } });
  mockDb.creator.findMany.mockImplementation(async ({ where }: any) => where.id.in.filter((id: string) => id !== "gone").map(row));
  mockDb.creator.updateMany.mockResolvedValue({ count: 1 });
  mockDb.creatorProfileLink.deleteMany.mockResolvedValue({ count: 2 });
  mockDb.creatorListItem.deleteMany.mockResolvedValue({ count: 1 });
});

describe("DELETE /api/creators/[id]", () => {
  it("is refused without a session and for a role without creators:delete", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await del("c1")).status).toBe(401);
    for (const role of ["MEMBER", "VIEWER"]) {
      mockAuth.mockResolvedValueOnce(session(role));
      expect((await del("c1")).status).toBe(403);
    }
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("answers 404 for a creator outside the org or already deleted", async () => {
    mockDb.creator.findFirst.mockResolvedValueOnce(null);
    expect((await del("c1")).status).toBe(404);
    expect(mockDb.creator.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", orgId: "org-1", deletedAt: null });
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("soft-deletes in the org, unlinks the portal login, frees the links and takes them out of lists", async () => {
    const res = await del("c1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id: "c1" });
    const update = mockDb.creator.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: { in: ["c1"] }, orgId: "org-1", deletedAt: null });
    expect(update.data).toEqual({ deletedAt: expect.any(Date), creatorUserId: null });
    expect(mockDb.creatorProfileLink.deleteMany).toHaveBeenCalledWith({ where: { orgId: "org-1", creatorId: { in: ["c1"] } } });
    expect(mockDb.creatorListItem.deleteMany).toHaveBeenCalledWith({ where: { creatorId: { in: ["c1"] }, list: { orgId: "org-1" } } });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it("allows managers and admins", async () => {
    for (const role of ["MANAGER", "ADMIN"]) {
      mockAuth.mockResolvedValueOnce(session(role));
      expect((await del("c1")).status).toBe(200);
    }
  });
});

describe("POST /api/creators/delete", () => {
  it("takes ticked ids only, never a filter query", async () => {
    expect((await bulk({ query: "platform=TIKTOK" })).status).toBe(400);
    expect((await bulk({ creatorIds: [] })).status).toBe(400);
    expect((await bulk({ creatorIds: Array.from({ length: 501 }, (_, i) => `c${i}`) })).status).toBe(400);
    expect(mockDb.creator.updateMany).not.toHaveBeenCalled();
  });

  it("is refused for MEMBER", async () => {
    mockAuth.mockResolvedValueOnce(session("MEMBER"));
    expect((await bulk({ creatorIds: ["c1"] })).status).toBe(403);
  });

  it("deletes what is live in the org and reports what was already gone", async () => {
    const res = await bulk({ creatorIds: ["c1", "c2", "c2", "gone"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: 3, deleted: 2 });
    expect(mockDb.creator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["c1", "c2", "gone"] }, orgId: "org-1", deletedAt: null });
    expect(mockDb.creator.updateMany.mock.calls[0][0].where.id).toEqual({ in: ["c1", "c2"] });
  });

  it("writes nothing when none of the ids is live in the org", async () => {
    const res = await bulk({ creatorIds: ["gone"] });
    expect(await res.json()).toEqual({ requested: 1, deleted: 0 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
