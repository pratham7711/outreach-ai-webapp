/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/lists/[id]/creators/[creatorId]/route";
import { POST as REORDER } from "@/app/api/lists/[id]/reorder/route";
import { POST as IMPORT_RATES } from "@/app/api/lists/[id]/import-rates/route";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: { findFirst: jest.fn() },
    creatorListItem: { findFirst: jest.fn(), findMany: jest.fn() },
    creatorListItemDetail: { upsert: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";

const mockDb = db as any;
const mockAuth = auth as jest.Mock;

const itemParams = (id: string, creatorId: string) => ({ params: Promise.resolve({ id, creatorId }) });
const listParams = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (url: string, body: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const upserts = () => mockDb.creatorListItemDetail.upsert.mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "MEMBER" } });
  (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
  mockDb.creatorList.findFirst.mockResolvedValue({ id: "list-1" });
  // $transaction is handed an array of upsert promises; resolving them is enough.
  mockDb.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  mockDb.creatorListItemDetail.upsert.mockImplementation(async ({ create }: any) => ({ rate: create.rate ?? null, notes: create.notes ?? null }));
  mockDb.creatorListItemDetail.findMany.mockResolvedValue([]);
});

// ─── PATCH one row's rate and notes ───────────────────────────────────────────

describe("PATCH /api/lists/[id]/creators/[creatorId]", () => {
  const patch = (body: unknown, creatorId = "c-1") =>
    PATCH(req(`/api/lists/list-1/creators/${creatorId}`, body, "PATCH"), itemParams("list-1", creatorId));

  beforeEach(() => {
    mockDb.creatorListItem.findFirst.mockResolvedValue({ id: "item-1" });
  });

  it("returns 401 when unauthenticated, and 403 for a viewer", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await patch({ rate: 500 })).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "VIEWER" } });
    expect((await patch({ rate: 500 })).status).toBe(403);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("says so before the list-approval migration has run", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await patch({ rate: 500 })).status).toBe(503);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("404s a list outside the org, scoping the lookup to the session's org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);
    expect((await patch({ rate: 500 })).status).toBe(404);
    expect(mockDb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "list-1", orgId: "org-1" });
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("404s a creator who is not on the list", async () => {
    mockDb.creatorListItem.findFirst.mockResolvedValue(null);
    expect((await patch({ rate: 500 }, "c-9")).status).toBe(404);
    expect(mockDb.creatorListItem.findFirst.mock.calls[0][0].where).toEqual({
      listId: "list-1",
      creatorId: "c-9",
      creator: { orgId: "org-1", deletedAt: null },
    });
  });

  it("saves a rate into the item's detail row, creating it on first write", async () => {
    const res = await patch({ rate: 1500 });
    expect(res.status).toBe(200);
    expect(upserts()).toEqual([
      { where: { itemId: "item-1" }, create: { itemId: "item-1", listId: "list-1", orgId: "org-1", rate: 1500 }, update: { rate: 1500 }, select: { rate: true, notes: true } },
    ]);
  });

  it("accepts a rate typed as a string, because the cell is a text input", async () => {
    await patch({ rate: "1250.50" });
    expect(upserts()[0].update).toEqual({ rate: 1250.5 });
  });

  it("clears a rate on an empty cell rather than storing zero", async () => {
    await patch({ rate: "" });
    expect(upserts()[0].update).toEqual({ rate: null });
  });

  it("400s a negative, non-numeric or absurd rate", async () => {
    expect((await patch({ rate: -5 })).status).toBe(400);
    expect((await patch({ rate: "abc" })).status).toBe(400);
    expect((await patch({ rate: 1e12 })).status).toBe(400);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("trims a note and stores null for a blank one", async () => {
    await patch({ notes: "   " });
    expect(upserts()[0].update).toEqual({ notes: null });
  });

  it("400s an over-long note", async () => {
    expect((await patch({ notes: "x".repeat(2001) })).status).toBe(400);
  });

  it("400s a body with nothing settable in it", async () => {
    // The verdict is the client's to set through the share link, never ours here.
    expect((await patch({ decision: "APPROVED" })).status).toBe(400);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });
});

// ─── Reorder ──────────────────────────────────────────────────────────────────

describe("POST /api/lists/[id]/reorder", () => {
  const reorder = (creatorIds: unknown) => REORDER(req("/api/lists/list-1/reorder", { creatorIds }), listParams("list-1"));

  beforeEach(() => {
    mockDb.creatorListItem.findMany.mockResolvedValue([
      { id: "item-1", creatorId: "c-1" },
      { id: "item-2", creatorId: "c-2" },
      { id: "item-3", creatorId: "c-3" },
    ]);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await reorder(["c-1"])).status).toBe(401);
  });

  it("writes a sortOrder per creator in the order given, in one transaction", async () => {
    const res = await reorder(["c-3", "c-1", "c-2"]);
    expect(res.status).toBe(200);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(upserts().map((u: any) => [u.where.itemId, u.update.sortOrder, u.create.orgId])).toEqual([
      ["item-3", 0, "org-1"],
      ["item-1", 1, "org-1"],
      ["item-2", 2, "org-1"],
    ]);
  });

  it("409s a partial order rather than stranding the rows it omits", async () => {
    expect((await reorder(["c-1", "c-2"])).status).toBe(409);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("409s an order naming a creator who is not on the list", async () => {
    expect((await reorder(["c-1", "c-2", "c-99"])).status).toBe(409);
  });

  it("400s duplicate ids and an empty order", async () => {
    expect((await reorder(["c-1", "c-1", "c-2"])).status).toBe(400);
    expect((await reorder([])).status).toBe(400);
  });
});

// ─── Import rates ─────────────────────────────────────────────────────────────

describe("POST /api/lists/[id]/import-rates", () => {
  const importRates = (body: unknown = {}) => IMPORT_RATES(req("/api/lists/list-1/import-rates", body), listParams("list-1"));

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await importRates()).status).toBe(401);
  });

  it("fills only the blank cells, leaving a negotiated rate alone", async () => {
    mockDb.creatorListItem.findMany.mockResolvedValue([
      { id: "item-1", creator: { rate: 900 } },
      { id: "item-2", creator: { rate: 800 } },
      { id: "item-3", creator: { rate: null } },
    ]);
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([
      { itemId: "item-2", rate: 2500, notes: null, sortOrder: null, decision: "PENDING", decisionNote: null, decidedAt: null },
    ]);
    const body = await (await importRates()).json();
    expect(body).toEqual({ imported: 1, skipped: 2, creatorsWithoutRate: 1 });
    expect(upserts().map((u: any) => [u.where.itemId, u.update])).toEqual([["item-1", { rate: 900 }]]);
  });

  it("overwrites a typed rate only when asked to", async () => {
    mockDb.creatorListItem.findMany.mockResolvedValue([
      { id: "item-1", creator: { rate: 900 } },
      { id: "item-2", creator: { rate: 800 } },
    ]);
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([
      { itemId: "item-2", rate: 2500, notes: null, sortOrder: null, decision: "PENDING", decisionNote: null, decidedAt: null },
    ]);
    const body = await (await importRates({ overwrite: true })).json();
    expect(body.imported).toBe(2);
    expect(upserts().map((u: any) => u.update)).toEqual([{ rate: 900 }, { rate: 800 }]);
  });

  it("reports zero imported rather than failing when no creator has a rate", async () => {
    mockDb.creatorListItem.findMany.mockResolvedValue([{ id: "item-1", creator: { rate: null } }]);
    const res = await importRates();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ imported: 0, skipped: 1, creatorsWithoutRate: 1 });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("404s a list outside the org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);
    expect((await importRates()).status).toBe(404);
  });
});
