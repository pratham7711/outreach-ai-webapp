/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/lists/[id]/duplicate/route";

jest.mock("@/lib/db", () => ({
  db: {
    creatorList: { findFirst: jest.fn(), create: jest.fn() },
    creatorListDetail: { create: jest.fn() },
    creatorListItem: { findMany: jest.fn(), createMany: jest.fn() },
    creatorListItemDetail: { findMany: jest.fn(), createMany: jest.fn() },
    creatorListShare: { create: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";

const mockDb = db as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const params = { params: Promise.resolve({ id: "list-1" }) };
const duplicate = (body: unknown = {}) =>
  POST(new NextRequest("http://localhost/api/lists/list-1/duplicate", { method: "POST", body: JSON.stringify(body) }), params);

const detail = (itemId: string, over: Record<string, unknown>) => ({
  itemId,
  rate: null,
  notes: null,
  sortOrder: null,
  decision: "PENDING",
  decisionNote: null,
  decidedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "MEMBER" } });
  (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
  mockDb.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb));
  mockDb.creatorList.findFirst.mockResolvedValue({ id: "list-1", name: "Spring pitch", description: "Q2" });
  mockDb.creatorList.create.mockImplementation(async ({ data }) => ({ id: "list-2", ...data }));
  // Newest first, as the plain list orders them.
  mockDb.creatorListItem.findMany.mockImplementation(async ({ where }) =>
    where.listId === "list-1"
      ? [
          { id: "i-4", creatorId: "c-4" },
          { id: "i-3", creatorId: "c-3" },
          { id: "i-2", creatorId: "c-2" },
          { id: "i-1", creatorId: "c-1" },
        ]
      : ["c-1", "c-2", "c-3", "c-4"].map((c) => ({ id: `new-${c}`, creatorId: c })),
  );
  mockDb.creatorListItemDetail.findMany.mockResolvedValue([
    detail("i-1", { sortOrder: 0, decision: "APPROVED", rate: 900, notes: "fast replies", decisionNote: "yes" }),
    detail("i-2", { sortOrder: 1, decision: "REJECTED", rate: 400 }),
    detail("i-3", { sortOrder: 2, decision: "PENDING" }),
    detail("i-4", { sortOrder: 3, decision: "APPROVED", rate: 1200 }),
  ]);
});

const copiedDetails = (): Array<Record<string, unknown>> => mockDb.creatorListItemDetail.createMany.mock.calls[0][0].data;

describe("POST /api/lists/[id]/duplicate", () => {
  it("returns 401 when unauthenticated and 403 for a viewer", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    expect((await duplicate()).status).toBe(401);
    (auth as jest.Mock).mockResolvedValue({ user: { id: "user-1", orgId: "org-1", role: "VIEWER" } });
    expect((await duplicate()).status).toBe(403);
    expect(mockDb.creatorList.create).not.toHaveBeenCalled();
  });

  it("says so before the list-approval migration has run", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await duplicate({ scope: "approved" })).status).toBe(503);
  });

  it("404s a list from another org, scoping the source read to the caller's org", async () => {
    mockDb.creatorList.findFirst.mockResolvedValue(null);
    expect((await duplicate()).status).toBe(404);
    expect(mockDb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "list-1", orgId: "org-1" });
    expect(mockDb.creatorListItem.findMany.mock.calls).toHaveLength(0);
  });

  it("copies only the approved creators when asked, in pitch order, re-indexed", async () => {
    const res = await duplicate({ scope: "approved" });
    expect(res.status).toBe(201);
    expect((await res.json()).list).toEqual({ id: "list-2", name: "Spring pitch (Copy)", creators: 2 });
    expect(mockDb.creatorListItem.createMany.mock.calls[0][0].data).toEqual([
      { listId: "list-2", creatorId: "c-1" },
      { listId: "list-2", creatorId: "c-4" },
    ]);
    // Re-indexed rather than copied: 0, 1 -- not 0, 3.
    expect(copiedDetails()).toEqual([
      { itemId: "new-c-1", listId: "list-2", orgId: "org-1", rate: 900, notes: "fast replies", sortOrder: 0 },
      { itemId: "new-c-4", listId: "list-2", orgId: "org-1", rate: 1200, notes: null, sortOrder: 1 },
    ]);
  });

  it("starts every verdict over, so the copy is a fresh pitch", async () => {
    await duplicate({ scope: "approved" });
    for (const row of copiedDetails()) {
      expect(row).not.toHaveProperty("decision");
      expect(row).not.toHaveProperty("decisionNote");
    }
  });

  it("copies every creator under the 'all' scope", async () => {
    await duplicate({ scope: "all" });
    expect(copiedDetails().map((d) => d.itemId)).toEqual(["new-c-1", "new-c-2", "new-c-3", "new-c-4"]);
  });

  it("records where the copy came from, and never carries the share link", async () => {
    await duplicate({ scope: "approved" });
    expect(mockDb.creatorListDetail.create.mock.calls[0][0].data).toEqual({ listId: "list-2", orgId: "org-1", duplicatedFromId: "list-1" });
    expect(mockDb.creatorList.create.mock.calls[0][0].data).toEqual({ orgId: "org-1", name: "Spring pitch (Copy)", description: "Q2" });
    expect(mockDb.creatorListShare.create).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "list.duplicate", entityId: "list-2" }));
  });

  it("takes a name, and defaults to '<name> (Copy)'", async () => {
    await duplicate({ name: "  Summer pitch  " });
    expect(mockDb.creatorList.create.mock.calls[0][0].data.name).toBe("Summer pitch");
  });

  it("409s an approved-only copy of a list with nothing approved", async () => {
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([detail("i-1", { decision: "REJECTED" })]);
    expect((await duplicate({ scope: "approved" })).status).toBe(409);
    expect(mockDb.creatorList.create).not.toHaveBeenCalled();
  });

  it("400s an unknown scope or key", async () => {
    expect((await duplicate({ scope: "declined" })).status).toBe(400);
    expect((await duplicate({ clientId: "x" })).status).toBe(400);
  });
});
