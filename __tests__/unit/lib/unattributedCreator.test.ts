/**
 * @jest-environment node
 *
 * lib/posts/unattributedCreator -- the holding row a post is filed under when
 * nobody can say who posted it. Two things matter: it is found again rather
 * than made twice, and nothing mistakes an ordinary roster row for it.
 */
const mockFindFirst = jest.fn();
const mockTransaction = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: (...a: unknown[]) => mockFindFirst(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import {
  UNATTRIBUTED_CREATOR_NAMES,
  UNATTRIBUTED_CREATOR_WHERE,
  getUnattributedCreator,
  isUnattributedCreator,
  unattributedCreatorName,
} from "@/lib/posts/unattributedCreator";

const ROW = { id: "c-hold", name: "Unattributed Instagram posts", handle: "" };

function txWith(found: unknown) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ held: 1 }]),
    creator: { findFirst: jest.fn().mockResolvedValue(found), create: jest.fn().mockResolvedValue(ROW) },
  };
  mockTransaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  return tx;
}

beforeEach(() => {
  mockFindFirst.mockReset();
  mockTransaction.mockReset();
});

describe("unattributedCreatorName", () => {
  it("names the platform the way the rest of the app does", () => {
    expect(unattributedCreatorName("INSTAGRAM")).toBe("Unattributed Instagram posts");
    expect(unattributedCreatorName("TIKTOK")).toBe("Unattributed TikTok posts");
    expect(unattributedCreatorName("YOUTUBE")).toBe("Unattributed YouTube posts");
  });

  it("reserves one name per platform", () => {
    expect(new Set(UNATTRIBUTED_CREATOR_NAMES).size).toBe(UNATTRIBUTED_CREATOR_NAMES.length);
    expect(UNATTRIBUTED_CREATOR_WHERE).toEqual({ handle: "", name: { in: UNATTRIBUTED_CREATOR_NAMES } });
  });
});

describe("isUnattributedCreator", () => {
  it("is the holding row only when the handle is empty AND the name is reserved", () => {
    expect(isUnattributedCreator({ handle: "", name: "Unattributed Instagram posts" })).toBe(true);
    // A roster row someone left without a handle is still a real person.
    expect(isUnattributedCreator({ handle: "", name: "Jane" })).toBe(false);
    // And a real account that happens to be called this is not the holding row.
    expect(isUnattributedCreator({ handle: "unattributed", name: "Unattributed Instagram posts" })).toBe(false);
  });
});

describe("getUnattributedCreator", () => {
  it("returns the org's existing row without opening a transaction", async () => {
    mockFindFirst.mockResolvedValue(ROW);
    await expect(getUnattributedCreator("org-1", "INSTAGRAM")).resolves.toEqual(ROW);
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      platform: "INSTAGRAM",
      handle: "",
      name: "Unattributed Instagram posts",
      deletedAt: null,
    });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("creates it under the org-and-platform lock when it does not exist", async () => {
    mockFindFirst.mockResolvedValue(null);
    const tx = txWith(null);
    await expect(getUnattributedCreator("org-1", "INSTAGRAM")).resolves.toEqual(ROW);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // The lock key is the interpolated value, so the org and platform are in it.
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(["unattributed-creator:org-1:INSTAGRAM"]);
    expect(tx.creator.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ orgId: "org-1", platform: "INSTAGRAM", handle: "", name: "Unattributed Instagram posts" }),
      select: { id: true, name: true, handle: true },
    });
    // Nothing that would make it trackable or reachable.
    const data = tx.creator.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("trackedSince");
    expect(data).not.toHaveProperty("contactEmail");
  });

  // Two links of one batch arrive together: the second waits on the lock, then
  // finds the row the first made instead of making its own.
  it("hands back the row a concurrent add made while it waited", async () => {
    mockFindFirst.mockResolvedValue(null);
    const tx = txWith(ROW);
    await expect(getUnattributedCreator("org-1", "INSTAGRAM")).resolves.toEqual(ROW);
    expect(tx.creator.create).not.toHaveBeenCalled();
  });
});
