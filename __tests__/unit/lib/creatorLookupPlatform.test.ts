/**
 * findCreatorByHandle — whose post is this, when two people on two platforms
 * answer to the same name.
 *
 * MEASURED on production 2026-09-16: 44 creator rows across 22 handles hold
 * the same handle on both Instagram and TikTok inside one org. The direct
 * lookup was not narrowing by platform, so an Instagram link by @gumenasaivfx
 * could be filed against the TikTok creator of that name -- and a post filed
 * against the wrong creator puts their views into a stranger's totals, which
 * is exactly what nobody re-checks by eye.
 */
const mockCreatorFindFirst = jest.fn();
const mockSocialFindFirst = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: (...a: any[]) => mockCreatorFindFirst(...a) },
    creatorSocialAccount: { findFirst: (...a: any[]) => mockSocialFindFirst(...a) },
  },
}));

import { findCreatorByHandle } from "@/lib/posts/addPostChecks";

const ORG = "org-1";

describe("findCreatorByHandle", () => {
  beforeEach(() => {
    mockCreatorFindFirst.mockReset().mockResolvedValue(null);
    mockSocialFindFirst.mockReset().mockResolvedValue(null);
  });

  it("narrows the roster lookup to the platform the URL named", async () => {
    await findCreatorByHandle(ORG, "gumenasaivfx", "INSTAGRAM");
    expect(mockCreatorFindFirst).toHaveBeenCalledTimes(1);
    expect(mockCreatorFindFirst.mock.calls[0][0].where).toMatchObject({
      orgId: ORG,
      deletedAt: null,
      platform: "INSTAGRAM",
    });
  });

  it("does not invent a platform filter when the URL named none", async () => {
    await findCreatorByHandle(ORG, "gumenasaivfx");
    expect(mockCreatorFindFirst.mock.calls[0][0].where).not.toHaveProperty("platform");
  });

  it("asks for a deterministic row, so duplicated handles resolve the same way twice", async () => {
    /* Twelve handles are duplicated outright by the CreatorCore import. An
       unordered findFirst can answer with a different row per call, which
       splits one creator's posts across two rows by luck of the scan. */
    await findCreatorByHandle(ORG, "phonknow", "YOUTUBE");
    expect(mockCreatorFindFirst.mock.calls[0][0].orderBy).toEqual([
      { trackedSince: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
  });

  it("still scopes every lookup to the org", async () => {
    await findCreatorByHandle(ORG, "jane", "TIKTOK");
    expect(mockCreatorFindFirst.mock.calls[0][0].where.orgId).toBe(ORG);
    expect(mockSocialFindFirst.mock.calls[0][0].where.creator).toMatchObject({
      orgId: ORG,
      deletedAt: null,
    });
  });

  it("returns the roster row without consulting linked accounts when it matches", async () => {
    mockCreatorFindFirst.mockResolvedValue({ id: "c1", name: "Jane", handle: "jane" });
    await expect(findCreatorByHandle(ORG, "jane", "TIKTOK")).resolves.toEqual({
      id: "c1", name: "Jane", handle: "jane",
    });
    expect(mockSocialFindFirst).not.toHaveBeenCalled();
  });

  it("falls through to the linked-account spelling, still platform-narrowed", async () => {
    mockSocialFindFirst.mockResolvedValue({
      creator: { id: "c2", name: "Jane", handle: "jane" },
    });
    await expect(findCreatorByHandle(ORG, "jane.official", "TIKTOK")).resolves.toEqual({
      id: "c2", name: "Jane", handle: "jane",
    });
    expect(mockSocialFindFirst.mock.calls[0][0].where.platform).toBe("TIKTOK");
  });

  it("reports nobody rather than guessing when neither column matches", async () => {
    await expect(findCreatorByHandle(ORG, "nobody", "INSTAGRAM")).resolves.toBeNull();
  });
});
