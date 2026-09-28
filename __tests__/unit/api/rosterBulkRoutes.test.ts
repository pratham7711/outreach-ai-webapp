/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), count: jest.fn() },
    creatorList: { findFirst: jest.fn(), create: jest.fn() },
    creatorListItem: { createMany: jest.fn() },
    creatorTagDef: { findFirst: jest.fn(), createMany: jest.fn() },
    creatorTagLink: { createMany: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { POST as saveAsList } from "@/app/api/lists/from-roster/route";
import { POST as tag } from "@/app/api/creators/tags/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const req = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const signIn = (role = "MEMBER") => (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role } });

beforeEach(() => {
  jest.clearAllMocks();
  signIn();
  mdb.creator.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
  mdb.creator.count.mockResolvedValue(2);
});

describe("POST /api/lists/from-roster", () => {
  it("creates a list in the caller's org and fills it in one insert", async () => {
    mdb.creatorList.create.mockResolvedValue({ id: "list-9", name: "Anime · 100K+" });
    mdb.creatorListItem.createMany.mockResolvedValue({ count: 2 });
    const res = await saveAsList(req("/api/lists/from-roster", { name: "  Anime · 100K+ ", query: "tags=Anime" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ listId: "list-9", name: "Anime · 100K+", created: true, added: 2, skipped: 0 });
    expect(mdb.creatorList.create.mock.calls[0][0].data).toEqual({ orgId: "org-1", name: "Anime · 100K+", description: null });
    expect(mdb.creatorListItem.createMany).toHaveBeenCalledWith({
      data: [{ listId: "list-9", creatorId: "a" }, { listId: "list-9", creatorId: "b" }],
      skipDuplicates: true,
    });
  });

  it("adds to an existing list and counts the ones already on it", async () => {
    mdb.creatorList.findFirst.mockResolvedValue({ id: "list-1", name: "Editors" });
    mdb.creatorListItem.createMany.mockResolvedValue({ count: 1 });
    const res = await saveAsList(req("/api/lists/from-roster", { listId: "list-1", creatorIds: ["a", "b"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ listId: "list-1", name: "Editors", created: false, added: 1, skipped: 1 });
    expect(mdb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "list-1", orgId: "org-1" });
    expect(mdb.creatorList.create).not.toHaveBeenCalled();
  });

  it("will not add to another org's list", async () => {
    mdb.creatorList.findFirst.mockResolvedValue(null);
    const res = await saveAsList(req("/api/lists/from-roster", { listId: "theirs", creatorIds: ["a"] }));
    expect(res.status).toBe(404);
    expect(mdb.creatorListItem.createMany).not.toHaveBeenCalled();
  });

  it("does not create an empty list when the filters match nobody", async () => {
    mdb.creator.count.mockResolvedValue(0);
    mdb.creator.findMany.mockResolvedValue([]);
    const res = await saveAsList(req("/api/lists/from-roster", { name: "Nobody", query: "tags=Nope" }));
    expect(res.status).toBe(400);
    expect(mdb.creatorList.create).not.toHaveBeenCalled();
  });

  it("needs a name or a list, and a selection", async () => {
    expect((await saveAsList(req("/api/lists/from-roster", { query: "" }))).status).toBe(400);
    expect((await saveAsList(req("/api/lists/from-roster", { name: "x" }))).status).toBe(400);
    expect((await saveAsList(req("/api/lists/from-roster", { name: "   ", query: "" }))).status).toBe(400);
  });

  it("is closed to viewers and to the signed-out", async () => {
    signIn("VIEWER");
    expect((await saveAsList(req("/api/lists/from-roster", { name: "x", query: "" }))).status).toBe(403);
    (auth as jest.Mock).mockResolvedValue(null);
    expect((await saveAsList(req("/api/lists/from-roster", { name: "x", query: "" }))).status).toBe(401);
  });
});

describe("POST /api/creators/tags", () => {
  it("adds an existing tag, matched without regard to case", async () => {
    mdb.creatorTagDef.findFirst.mockResolvedValue({ id: "t1", name: "Priority" });
    mdb.creatorTagLink.createMany.mockResolvedValue({ count: 1 });
    const res = await tag(req("/api/creators/tags", { tag: "priority", action: "add", creatorIds: ["a", "b"] }));
    expect(await res.json()).toEqual({ tag: "Priority", changed: 1, requested: 2 });
    expect(mdb.creatorTagDef.findFirst.mock.calls[0][0].where).toEqual({ orgId: "org-1", name: { equals: "priority", mode: "insensitive" } });
    expect(mdb.creatorTagDef.createMany).not.toHaveBeenCalled();
    expect(mdb.creatorTagLink.createMany).toHaveBeenCalledWith({
      data: [{ creatorId: "a", tagId: "t1" }, { creatorId: "b", tagId: "t1" }],
      skipDuplicates: true,
    });
  });

  it("creates a new tag in the caller's org", async () => {
    mdb.creatorTagDef.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "t2", name: "Shortlist" });
    mdb.creatorTagLink.createMany.mockResolvedValue({ count: 2 });
    await tag(req("/api/creators/tags", { tag: "Shortlist", action: "add", query: "" }));
    expect(mdb.creatorTagDef.createMany).toHaveBeenCalledWith({ data: [{ orgId: "org-1", name: "Shortlist" }], skipDuplicates: true });
  });

  it("removes only from the selected creators", async () => {
    mdb.creatorTagDef.findFirst.mockResolvedValue({ id: "t1", name: "Priority" });
    mdb.creatorTagLink.deleteMany.mockResolvedValue({ count: 2 });
    await tag(req("/api/creators/tags", { tag: "Priority", action: "remove", creatorIds: ["a", "b"] }));
    expect(mdb.creatorTagLink.deleteMany).toHaveBeenCalledWith({ where: { tagId: "t1", creatorId: { in: ["a", "b"] } } });
  });

  it("removing a tag nobody has is a no-op, not a new tag", async () => {
    mdb.creatorTagDef.findFirst.mockResolvedValue(null);
    const res = await tag(req("/api/creators/tags", { tag: "Ghost", action: "remove", creatorIds: ["a", "b"] }));
    expect(await res.json()).toEqual({ changed: 0, tag: "Ghost" });
    expect(mdb.creatorTagDef.createMany).not.toHaveBeenCalled();
    expect(mdb.creatorTagLink.deleteMany).not.toHaveBeenCalled();
  });

  it("writes the audit log only when something changed", async () => {
    mdb.creatorTagDef.findFirst.mockResolvedValue({ id: "t1", name: "Priority" });
    mdb.creatorTagLink.createMany.mockResolvedValue({ count: 0 });
    await tag(req("/api/creators/tags", { tag: "Priority", action: "add", creatorIds: ["a", "b"] }));
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses a blank tag, an unknown action and a viewer", async () => {
    expect((await tag(req("/api/creators/tags", { tag: " ", action: "add", creatorIds: ["a"] }))).status).toBe(400);
    expect((await tag(req("/api/creators/tags", { tag: "x", action: "rename", creatorIds: ["a"] }))).status).toBe(400);
    signIn("VIEWER");
    expect((await tag(req("/api/creators/tags", { tag: "x", action: "add", creatorIds: ["a"] }))).status).toBe(403);
  });
});
