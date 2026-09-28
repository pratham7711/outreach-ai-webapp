/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({ db: { creator: { findMany: jest.fn(), count: jest.fn() } } }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { db } from "@/lib/db";
import { MAX_BULK_CREATORS, resolveRosterSelection, rosterSelectionSchema } from "@/lib/creators/rosterSelection";

const mdb = db as unknown as { creator: { findMany: jest.Mock; count: jest.Mock } };

beforeEach(() => jest.clearAllMocks());

describe("resolveRosterSelection: ticked rows", () => {
  it("checks every id against the org, once each", async () => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const out = await resolveRosterSelection("org-1", { creatorIds: ["a", "b", "a"] });
    expect(out).toEqual({ ok: true, ids: ["a", "b"] });
    expect(mdb.creator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, orgId: "org-1", deletedAt: null });
  });

  it("refuses the whole selection when any id is not the org's", async () => {
    mdb.creator.findMany.mockResolvedValue([{ id: "a" }]);
    const out = await resolveRosterSelection("org-1", { creatorIds: ["a", "someone-elses"] });
    expect(out).toMatchObject({ ok: false, status: 404 });
  });
});

describe("resolveRosterSelection: everything matching", () => {
  it("builds the where from the query, but the org from the caller", async () => {
    mdb.creator.count.mockResolvedValue(2);
    mdb.creator.findMany.mockResolvedValue([{ id: "x" }, { id: "y" }]);
    const out = await resolveRosterSelection("org-1", { query: "?orgId=org-2&tags=Anime&minFollowers=100000" });
    expect(out).toEqual({ ok: true, ids: ["x", "y"] });
    const where = mdb.creator.count.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    expect(where.deletedAt).toBeNull();
    expect(where.tagLinks).toEqual({ some: { tag: { name: { in: ["Anime"] } } } });
    expect(where.followersCount).toEqual({ gte: 100000 });
    expect(mdb.creator.findMany.mock.calls[0][0].where).toEqual(where);
  });

  it("keeps the roster's order, so a saved list reads like the screen it came from", async () => {
    mdb.creator.count.mockResolvedValue(1);
    mdb.creator.findMany.mockResolvedValue([{ id: "x" }]);
    await resolveRosterSelection("org-1", { query: "sort=price&dir=desc" });
    expect(mdb.creator.findMany.mock.calls[0][0].orderBy[0]).toEqual({ rate: { sort: "desc", nulls: "last" } });
  });

  it("refuses more than the cap without reading a single id", async () => {
    mdb.creator.count.mockResolvedValue(MAX_BULK_CREATORS + 1);
    const out = await resolveRosterSelection("org-1", { query: "" });
    expect(out).toMatchObject({ ok: false, status: 413 });
    expect(mdb.creator.findMany).not.toHaveBeenCalled();
  });
});

describe("rosterSelectionSchema", () => {
  it("takes ids or a query, and nothing empty or oversized", () => {
    expect(rosterSelectionSchema.safeParse({ creatorIds: ["a"] }).success).toBe(true);
    expect(rosterSelectionSchema.safeParse({ query: "tags=Anime" }).success).toBe(true);
    expect(rosterSelectionSchema.safeParse({ creatorIds: [] }).success).toBe(false);
    expect(rosterSelectionSchema.safeParse({ creatorIds: Array.from({ length: MAX_BULK_CREATORS + 1 }, (_, i) => `c${i}`) }).success).toBe(false);
    expect(rosterSelectionSchema.safeParse({}).success).toBe(false);
  });
});
