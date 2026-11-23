/**
 * @jest-environment node
 *
 * A creator who joined through the link is folded into the agency's own row
 * only when the platform has confirmed the handle that row names, and only
 * when exactly one row fits.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorJoinRecord: { findUnique: jest.fn(), findMany: jest.fn() },
    creator: { findMany: jest.fn(), updateMany: jest.fn() },
    creatorProfileLink: { findMany: jest.fn() },
    creatorSocialAccount: { count: jest.fn() },
  },
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn(async () => true) }));
jest.mock("@/lib/creators/mergeCreators", () => ({
  loadMergeSide: jest.fn(async (_o: string, id: string) => ({ id, name: id, handle: id })),
  planMerge: jest.fn(() => ({ ok: true, plan: { creator: {} } })),
  countOwnedRows: jest.fn(async () => ({})),
  executeMerge: jest.fn(async () => undefined),
}));

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { executeMerge, planMerge } from "@/lib/creators/mergeCreators";
import { joinMarks, mergeJoinedIntoMatch } from "@/lib/creators/joinDuplicates";

const m = db as unknown as {
  creatorJoinRecord: { findUnique: jest.Mock; findMany: jest.Mock };
  creator: { findMany: jest.Mock; updateMany: jest.Mock };
  creatorProfileLink: { findMany: jest.Mock };
  creatorSocialAccount: { count: jest.Mock };
};

const input = { orgId: "org1", joinedCreatorId: "joined", platform: "INSTAGRAM" as const, verifiedHandle: "@Maya.Creates" };

beforeEach(() => {
  jest.clearAllMocks();
  m.creatorJoinRecord.findUnique.mockResolvedValue({ orgId: "org1", creatorUserId: "cu1" });
  m.creatorSocialAccount.count.mockResolvedValue(0);
  m.creator.updateMany.mockResolvedValue({ count: 1 });
});

describe("mergeJoinedIntoMatch", () => {
  it("folds the joined row into the one agency row naming the confirmed handle", async () => {
    m.creator.findMany.mockResolvedValue([{ id: "sheet" }]);
    await expect(mergeJoinedIntoMatch(input)).resolves.toBe("sheet");
    const [, keep, drop] = (executeMerge as jest.Mock).mock.calls[0];
    expect(keep.id).toBe("sheet");
    expect(drop.id).toBe("joined");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "creator.join_merged", entityId: "sheet" }));
  });

  it("looks only on that platform, in that org, and never at a row signed in as someone else", async () => {
    m.creator.findMany.mockResolvedValue([]);
    await mergeJoinedIntoMatch(input);
    const where = m.creator.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ orgId: "org1", deletedAt: null, id: { not: "joined" } });
    expect(where.OR).toEqual([{ creatorUserId: null }, { creatorUserId: "cu1" }]);
    const json = JSON.stringify(where.AND);
    expect(json).toContain('"platform":"INSTAGRAM"');
    expect(json).toContain('"equals":"maya.creates"');
    expect(json).not.toContain("TIKTOK");
  });

  it("with no match, sets a new creator's platform to the one they connected", async () => {
    m.creator.findMany.mockResolvedValue([]);
    await expect(mergeJoinedIntoMatch(input)).resolves.toBeNull();
    expect(m.creator.updateMany).toHaveBeenCalledWith({
      where: { id: "joined", orgId: "org1", platform: { not: "INSTAGRAM" } },
      data: { platform: "INSTAGRAM" },
    });
    expect(executeMerge).not.toHaveBeenCalled();
  });

  it("leaves the platform alone once another platform is connected", async () => {
    m.creator.findMany.mockResolvedValue([]);
    m.creatorSocialAccount.count.mockResolvedValue(1);
    await mergeJoinedIntoMatch(input);
    expect(m.creator.updateMany).not.toHaveBeenCalled();
  });

  it("merges nothing when two rows fit", async () => {
    m.creator.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    await expect(mergeJoinedIntoMatch(input)).resolves.toBeNull();
    expect(executeMerge).not.toHaveBeenCalled();
  });

  it("merges nothing for a row that did not join through the link", async () => {
    m.creatorJoinRecord.findUnique.mockResolvedValue(null);
    await expect(mergeJoinedIntoMatch(input)).resolves.toBeNull();
    expect(m.creator.findMany).not.toHaveBeenCalled();
  });

  it("merges nothing the merge itself refuses", async () => {
    m.creator.findMany.mockResolvedValue([{ id: "sheet" }]);
    (planMerge as jest.Mock).mockReturnValueOnce({ ok: false, error: "different people" });
    await expect(mergeJoinedIntoMatch(input)).resolves.toBeNull();
    expect(executeMerge).not.toHaveBeenCalled();
  });

  it("never throws: a failed merge leaves the mark for the agency", async () => {
    m.creator.findMany.mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(mergeJoinedIntoMatch(input)).resolves.toBeNull();
  });
});

describe("joinMarks", () => {
  it("marks a joined row and names the rows sharing its handle or email", async () => {
    m.creatorJoinRecord.findMany.mockResolvedValue([
      { creatorId: "joined", joinedAt: new Date("2026-11-23T10:00:00Z"), creator: { handle: "maya.creates", contactEmail: "maya@example.com" } },
    ]);
    m.creator.findMany
      .mockResolvedValueOnce([{ id: "sheet", name: "Maya", handle: "@Maya.Creates" }])
      .mockResolvedValueOnce([{ id: "other", name: "M. K.", handle: "mk", contactEmail: "MAYA@example.com" }]);
    m.creatorProfileLink.findMany.mockResolvedValue([]);
    const marks = await joinMarks("org1", ["joined", "sheet"]);
    expect(marks.get("joined")?.duplicates.map((d) => d.id).sort()).toEqual(["other", "sheet"]);
    expect(marks.has("sheet")).toBe(false);
  });

  it("is empty while the table does not exist yet", async () => {
    m.creatorJoinRecord.findMany.mockRejectedValue(Object.assign(new Error("x"), { code: "P2021" }));
    await expect(joinMarks("org1", ["a"])).resolves.toEqual(new Map());
  });
});
