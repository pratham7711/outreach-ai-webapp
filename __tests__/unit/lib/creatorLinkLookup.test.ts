/**
 * @jest-environment node
 *
 * creatorsByProfileLink -- the roster's own record of a creator's other
 * accounts, which the post, add-creator and DM-join lookups now consult.
 */
const mockFindMany = jest.fn();
const mockRaw = jest.fn();
jest.mock("@/lib/db", () => ({
  db: { creatorProfileLink: { findMany: (...a: unknown[]) => mockFindMany(...a) }, $queryRawUnsafe: (...a: unknown[]) => mockRaw(...a) },
}));

import { creatorsByProfileLink } from "@/lib/creators/linkLookup";
import { ROSTER_TABLES } from "@/lib/creators/rosterSchemaDdl";
import { resetRosterTablesCache } from "@/lib/creators/rosterTables";

beforeEach(() => {
  mockFindMany.mockReset().mockResolvedValue([{ creator: { id: "c1", name: "Jane", handle: "@jane" } }]);
  mockRaw.mockReset().mockResolvedValue([{ n: ROSTER_TABLES.length }]);
  resetRosterTablesCache();
});

describe("creatorsByProfileLink", () => {
  it("matches both spellings case-insensitively, in the org, on live creators, on the platform", async () => {
    await expect(creatorsByProfileLink("org-1", "@Jane.IG", "INSTAGRAM")).resolves.toEqual([{ id: "c1", name: "Jane", handle: "@jane" }]);
    const q = mockFindMany.mock.calls[0][0];
    expect(q.where).toEqual({
      orgId: "org-1",
      platform: "INSTAGRAM",
      OR: [
        { handle: { equals: "Jane.IG", mode: "insensitive" } },
        { handle: { equals: "@Jane.IG", mode: "insensitive" } },
      ],
      creator: { orgId: "org-1", deletedAt: null },
    });
    expect(q.orderBy).toEqual([{ isPrimary: "desc" }, { createdAt: "asc" }]);
  });

  it("does not narrow the platform when none is known", async () => {
    await creatorsByProfileLink("org-1", "jane");
    expect(mockFindMany.mock.calls[0][0].where).not.toHaveProperty("platform");
  });

  it("asks nothing for an empty handle or before the roster tables exist", async () => {
    await expect(creatorsByProfileLink("org-1", "@", "TIKTOK")).resolves.toEqual([]);
    mockRaw.mockResolvedValue([{ n: 0 }]);
    await expect(creatorsByProfileLink("org-1", "jane", "TIKTOK")).resolves.toEqual([]);
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});
