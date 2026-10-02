/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/l/[token]/decision/route";

jest.mock("@/lib/db", () => ({
  db: {
    creatorListShare: { findUnique: jest.fn(), findMany: jest.fn() },
    creatorListDetail: { findFirst: jest.fn() },
    creatorListItem: { findFirst: jest.fn(), findMany: jest.fn() },
    creatorListItemDetail: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";

const mockDb = db as any;
const TOKEN = "fake-share-token";

const shareRow = (over: Record<string, unknown> = {}) => ({
  token: TOKEN,
  orgId: "org-1",
  fields: { stats: true, tags: true, audienceCountry: true, price: false, review: { approvals: true, feedback: true } },
  revokedAt: null,
  list: { id: "list-1", orgId: "org-1", name: "Spring pitch", description: null, org: { name: "Agency" } },
  ...over,
});
const detailRow = (itemId: string, decision: string, decisionNote: string | null = null) => ({
  itemId,
  rate: null,
  notes: null,
  sortOrder: null,
  decision,
  decisionNote,
  decidedAt: decision === "PENDING" ? null : new Date("2026-09-30T00:00:00Z"),
});

function decide(body: unknown, token = TOKEN) {
  return POST(
    new NextRequest(`http://localhost/api/l/${token}/decision`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.7" },
    }),
    { params: Promise.resolve({ token }) },
  );
}
const upsertArg = () => mockDb.creatorListItemDetail.upsert.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  (listApprovalTablesReady as jest.Mock).mockResolvedValue(true);
  mockDb.creatorListShare.findUnique.mockResolvedValue(shareRow());
  mockDb.creatorListShare.findMany.mockResolvedValue([{ listId: "list-1" }]);
  mockDb.creatorListDetail.findFirst.mockResolvedValue(null);
  mockDb.creatorListItem.findFirst.mockResolvedValue({ id: "item-1" });
  mockDb.creatorListItem.findMany.mockResolvedValue([{ id: "item-1" }, { id: "item-2" }]);
  mockDb.creatorListItemDetail.findMany.mockResolvedValue([]);
  mockDb.creatorListItemDetail.upsert.mockImplementation(async ({ update }: any) => update);
});

describe("POST /api/l/[token]/decision", () => {
  it("records an approval against the creator's item, scoped through the token", async () => {
    const res = await decide({ creatorId: "c-1", decision: "APPROVED" });
    expect(res.status).toBe(200);
    expect(mockDb.creatorListItem.findFirst.mock.calls[0][0].where).toEqual({
      listId: "list-1",
      creatorId: "c-1",
      creator: { orgId: "org-1", deletedAt: null },
    });
    expect(upsertArg().where).toEqual({ itemId: "item-1" });
    expect(upsertArg().create).toMatchObject({ itemId: "item-1", listId: "list-1", orgId: "org-1", decision: "APPROVED" });
    expect(upsertArg().update.decidedAt).toBeInstanceOf(Date);
  });

  it("stores the client's note with a decline", async () => {
    await decide({ creatorId: "c-1", decision: "REJECTED", note: "  Off-brand for this launch  " });
    expect(upsertArg().update).toMatchObject({ decision: "REJECTED", decisionNote: "Off-brand for this launch" });
  });

  it("clears the note when a decision is undone", async () => {
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([detailRow("item-1", "REJECTED", "no")]);
    await decide({ creatorId: "c-1", decision: "PENDING", note: "ignored" });
    expect(upsertArg().update).toEqual({ decision: "PENDING", decisionNote: null, decidedAt: null });
  });

  it("403s a verdict on a link shared for viewing only", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(shareRow({ fields: { review: { approvals: false } } }));
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" })).status).toBe(403);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("403s a verdict on a link minted before review existed", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(shareRow({ fields: { stats: true, tags: true, audienceCountry: true, price: false } }));
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" })).status).toBe(403);
  });

  it("403s a note on a link with feedback switched off, but still takes a bare verdict", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(shareRow({ fields: { review: { approvals: true, feedback: false } } }));
    expect((await decide({ creatorId: "c-1", decision: "REJECTED", note: "why" })).status).toBe(403);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
    expect((await decide({ creatorId: "c-1", decision: "REJECTED" })).status).toBe(200);
  });

  it("404s a revoked link and an unknown token", async () => {
    mockDb.creatorListShare.findUnique.mockResolvedValue(shareRow({ revokedAt: new Date() }));
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" })).status).toBe(404);
    mockDb.creatorListShare.findUnique.mockResolvedValue(null);
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" }, "unknown-token")).status).toBe(404);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("404s while the list-approval tables are absent", async () => {
    (listApprovalTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" })).status).toBe(404);
  });

  it("409s a list that has been archived", async () => {
    mockDb.creatorListDetail.findFirst.mockResolvedValue({ isFavorite: false, archivedAt: new Date(), duplicatedFromId: null });
    expect((await decide({ creatorId: "c-1", decision: "APPROVED" })).status).toBe(409);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("refuses a creator who is not on this link's list", async () => {
    mockDb.creatorListItem.findFirst.mockResolvedValue(null);
    expect((await decide({ creatorId: "someone-else", decision: "APPROVED" })).status).toBe(404);
  });

  it("400s an unknown verdict, a missing creator and an over-long note", async () => {
    expect((await decide({ creatorId: "c-1", decision: "MAYBE" })).status).toBe(400);
    expect((await decide({ decision: "APPROVED" })).status).toBe(400);
    expect((await decide({ creatorId: "c-1", decision: "REJECTED", note: "x".repeat(1001) })).status).toBe(400);
    expect(mockDb.creatorListItemDetail.upsert).not.toHaveBeenCalled();
  });

  it("reports the rolled-up list status back to the page", async () => {
    mockDb.creatorListItemDetail.findMany.mockResolvedValue([detailRow("item-2", "REJECTED")]);
    const body = await (await decide({ creatorId: "c-1", decision: "APPROVED" })).json();
    expect(body.list).toEqual({ status: "APPROVED", counts: { total: 2, approved: 1, rejected: 1, pending: 0 } });
    expect(body.verdict.decision).toBe("APPROVED");
  });

  it("audits the verdict against the link, never naming the token", async () => {
    await decide({ creatorId: "c-1", decision: "APPROVED" });
    const entry = (logAudit as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({ orgId: "org-1", actorType: "share_link", action: "list.client_decision", entityId: "list-1" });
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
  });
});
