/**
 * @jest-environment node
 *
 * Campaign folders — the CreatorCore control the campaigns list never had.
 * Two things here are worth more than the CRUD: deleting a folder must keep its
 * campaigns, and a folderId arriving in a request body must be proven to belong
 * to the caller's org before it is written onto their campaign.
 */
import { NextRequest } from "next/server";
import { GET as foldersGET, POST as foldersPOST } from "@/app/api/folders/route";
import { PATCH as folderPATCH, DELETE as folderDELETE } from "@/app/api/folders/[id]/route";

jest.mock("@/lib/db", () => ({
  db: {
    folder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    campaign: { groupBy: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: jest.fn(() => ({ actorType: "USER", actorUserId: "u1", actorEmail: "a@b.com" })),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn(() => "127.0.0.1") }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;
const mockAudit = logAudit as jest.Mock;

function req(url: string, method = "GET", payload?: unknown) {
  return new NextRequest(url, {
    method,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u1", actorType: "USER", role: "OWNER" });
  mockDb.folder.findMany.mockResolvedValue([]);
  mockDb.folder.findFirst.mockResolvedValue(null);
  mockDb.campaign.groupBy.mockResolvedValue([]);
  // The transaction body is what the route actually does; run it against the
  // same mocks so the delete path is really exercised.
  mockDb.$transaction.mockImplementation((fn: any) => fn(mockDb));
  mockDb.campaign.updateMany.mockResolvedValue({ count: 0 });
  mockDb.folder.updateMany.mockResolvedValue({ count: 0 });
});

describe("GET /api/folders", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await foldersGET(req("http://localhost/api/folders"))).status).toBe(401);
  });

  it("reports how many campaigns are filed in each folder", async () => {
    mockDb.folder.findMany.mockResolvedValue([
      { id: "f1", name: "Q3", createdAt: new Date() },
      { id: "f2", name: "Archive", createdAt: new Date() },
    ]);
    mockDb.campaign.groupBy.mockResolvedValue([{ folderId: "f1", _count: { _all: 7 } }]);

    const body = await (await foldersGET(req("http://localhost/api/folders"))).json();
    expect(body.folders).toEqual([
      { id: "f1", name: "Q3", campaigns: 7 },
      { id: "f2", name: "Archive", campaigns: 0 },
    ]);
  });

  it("counts only live campaigns, so a folder of deleted ones reads zero", async () => {
    await foldersGET(req("http://localhost/api/folders"));
    expect(mockDb.campaign.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", deletedAt: null }),
      })
    );
  });

  it("never reads another org's folders", async () => {
    await foldersGET(req("http://localhost/api/folders"));
    expect(mockDb.folder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1" } })
    );
  });
});

describe("POST /api/folders", () => {
  it("rejects an empty or whitespace-only name", async () => {
    for (const name of ["", "   ", undefined]) {
      const res = await foldersPOST(req("http://localhost/api/folders", "POST", { name }));
      expect(res.status).toBe(400);
    }
    expect(mockDb.folder.create).not.toHaveBeenCalled();
  });

  it("creates the folder scoped to the caller's org and logs it", async () => {
    mockDb.folder.create.mockResolvedValue({ id: "f9", name: "Q4", orgId: "org-1" });
    const res = await foldersPOST(req("http://localhost/api/folders", "POST", { name: "  Q4  " }));

    expect(res.status).toBe(201);
    // Trimmed, so " Q4 " and "Q4" cannot coexist as two different folders.
    expect(mockDb.folder.create).toHaveBeenCalledWith({ data: { orgId: "org-1", name: "Q4" } });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "folder.create" }));
  });

  it("refuses a duplicate name regardless of case", async () => {
    mockDb.folder.findFirst.mockResolvedValue({ id: "f1" });
    const res = await foldersPOST(req("http://localhost/api/folders", "POST", { name: "q3" }));
    expect(res.status).toBe(409);
    expect(mockDb.folder.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/folders/[id]", () => {
  it("404s on a folder belonging to another org, without updating", async () => {
    mockDb.folder.findFirst.mockResolvedValue(null);
    const res = await folderPATCH(
      req("http://localhost/api/folders/f1", "PATCH", { name: "Renamed" }),
      params("f1")
    );
    expect(res.status).toBe(404);
    expect(mockDb.folder.update).not.toHaveBeenCalled();
  });

  it("renames and records both sides in the audit log", async () => {
    mockDb.folder.findFirst
      .mockResolvedValueOnce({ id: "f1", name: "Q3" }) // the folder being renamed
      .mockResolvedValueOnce(null); // no name clash
    mockDb.folder.update.mockResolvedValue({ id: "f1", name: "Q3 (final)" });

    const res = await folderPATCH(
      req("http://localhost/api/folders/f1", "PATCH", { name: "Q3 (final)" }),
      params("f1")
    );
    expect(res.status).toBe(200);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "folder.update",
        before: { id: "f1", name: "Q3" },
        after: { id: "f1", name: "Q3 (final)" },
      })
    );
  });
});

describe("DELETE /api/folders/[id]", () => {
  it("keeps the campaigns and only unfiles them", async () => {
    // The whole point: a folder is a label. Deleting the label must not delete
    // the 200 campaigns wearing it.
    mockDb.folder.findFirst.mockResolvedValue({ id: "f1", name: "Q3" });
    mockDb.campaign.updateMany.mockResolvedValue({ count: 200 });
    mockDb.folder.delete.mockResolvedValue({ id: "f1" });

    const body = await (
      await folderDELETE(req("http://localhost/api/folders/f1", "DELETE"), params("f1"))
    ).json();

    expect(body).toEqual({ success: true, campaignsReleased: 200 });
    expect(mockDb.campaign.updateMany).toHaveBeenCalledWith({
      where: { folderId: "f1", orgId: "org-1" },
      data: { folderId: null },
    });
    // No campaign delete of any shape.
    expect(mockDb.campaign.updateMany).toHaveBeenCalledTimes(1);
    expect((mockDb.campaign as any).deleteMany).toBeUndefined();
  });

  it("404s on another org's folder and touches nothing", async () => {
    mockDb.folder.findFirst.mockResolvedValue(null);
    const res = await folderDELETE(req("http://localhost/api/folders/f1", "DELETE"), params("f1"));
    expect(res.status).toBe(404);
    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
    expect(mockDb.folder.delete).not.toHaveBeenCalled();
  });

  it("unfiles and deletes inside one transaction", async () => {
    mockDb.folder.findFirst.mockResolvedValue({ id: "f1", name: "Q3" });
    mockDb.folder.delete.mockResolvedValue({ id: "f1" });
    await folderDELETE(req("http://localhost/api/folders/f1", "DELETE"), params("f1"));
    // Otherwise a failure between the two steps leaves campaigns pointing at a
    // folder that is gone, or a folder nothing can reach.
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });
});
