/**
 * @jest-environment node
 *
 * node, not jsdom: listFilters imports the Prisma client for its generated
 * types, and the Prisma runtime needs TextEncoder, which jsdom does not provide.
 */
import {
  CREATOR_SORT_KEYS,
  DEFAULT_CREATOR_SORT,
  creatorOrderBy,
  readCreatorSort,
} from "@/lib/listFilters";

describe("readCreatorSort", () => {
  it("defaults to newest first, which is what the list did before it was sortable", () => {
    expect(readCreatorSort({})).toEqual({ key: "added", dir: "desc" });
    expect(DEFAULT_CREATOR_SORT).toEqual({ key: "added", dir: "desc" });
  });

  it("ignores a column the database cannot order by", () => {
    // ?sort=avgViews would otherwise sort one page and look like it worked.
    for (const key of ["avgViews", "campaigns", "followers", "; drop table", ""]) {
      expect(readCreatorSort({ sort: key })).toEqual(DEFAULT_CREATOR_SORT);
    }
  });

  it("accepts every key it advertises", () => {
    for (const key of CREATOR_SORT_KEYS) {
      expect(readCreatorSort({ sort: key, dir: "asc" })).toEqual({ key, dir: "asc" });
    }
  });

  it("treats any direction other than asc as desc", () => {
    expect(readCreatorSort({ sort: "name", dir: "sideways" }).dir).toBe("desc");
    expect(readCreatorSort({ sort: "name" }).dir).toBe("desc");
  });
});

describe("creatorOrderBy", () => {
  it("ends every ordering with a unique tiebreaker", () => {
    // The reason this matters: 1,834 creators share only 1,825 distinct addedAt
    // values, and Postgres gives no stable order within a tie. With skip/take a
    // tie across a page boundary returns one creator twice and another never,
    // so paging a sorted list would quietly be incomplete.
    for (const key of CREATOR_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        const order = creatorOrderBy({ key, dir });
        expect(order.length).toBeGreaterThanOrEqual(2);
        expect(order[order.length - 1]).toEqual({ id: "asc" });
      }
    }
  });

  it("orders posts through the relation count, not a column that does not exist", () => {
    expect(creatorOrderBy({ key: "posts", dir: "desc" })[0]).toEqual({ posts: { _count: "desc" } });
  });

  it("carries the requested direction on the primary key", () => {
    expect(creatorOrderBy({ key: "name", dir: "asc" })[0]).toEqual({ name: "asc" });
    expect(creatorOrderBy({ key: "added", dir: "desc" })[0]).toEqual({ addedAt: "desc" });
  });

  it("does not offer followers, whose zeros are unknowns", () => {
    // followersCount is Float @default(0), so 1,823 unimported counts are 0 and
    // not NULL. Ascending would rank them all as the least-followed creator.
    expect(CREATOR_SORT_KEYS).not.toContain("followers");
  });
});
