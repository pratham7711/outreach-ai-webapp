/**
 * @jest-environment node
 *
 * node, not jsdom: listFilters imports the Prisma client for its generated
 * types, and the Prisma runtime needs TextEncoder, which jsdom does not provide.
 */
import {
  CAMPAIGN_SORT_KEYS,
  DEFAULT_CAMPAIGN_SORT,
  campaignOrderBy,
  isDefaultCampaignSort,
  readCampaignSort,
} from "@/lib/listFilters";

/* The campaigns list pages with skip/take, so the order it asks for has to be
   total. 519 campaigns share only 516 distinct updatedAt values, and Postgres
   promises nothing about order within a tie — which is how a list drops one row
   and shows another twice while looking perfectly normal. */

describe("readCampaignSort", () => {
  it("defaults to most recently updated first", () => {
    expect(readCampaignSort({})).toEqual({ key: "updated", dir: "desc" });
    expect(DEFAULT_CAMPAIGN_SORT).toEqual({ key: "updated", dir: "desc" });
  });

  it("reads a key and direction it recognises", () => {
    expect(readCampaignSort({ sort: "created", dir: "asc" })).toEqual({ key: "created", dir: "asc" });
  });

  it("falls back rather than trusting the query string", () => {
    // A hand-edited URL must not reach Prisma as an unknown column.
    expect(readCampaignSort({ sort: "budget" })).toEqual(DEFAULT_CAMPAIGN_SORT);
    expect(readCampaignSort({ sort: "'; DROP TABLE" })).toEqual(DEFAULT_CAMPAIGN_SORT);
    expect(readCampaignSort({ sort: "" })).toEqual(DEFAULT_CAMPAIGN_SORT);
  });

  it("treats any direction that is not asc as desc", () => {
    expect(readCampaignSort({ sort: "created", dir: "sideways" }).dir).toBe("desc");
    expect(readCampaignSort({ sort: "created" }).dir).toBe("desc");
  });

  it("takes the first value when a param is repeated", () => {
    expect(readCampaignSort({ sort: ["created", "updated"], dir: ["asc"] })).toEqual({
      key: "created",
      dir: "asc",
    });
  });

  it("offers no sort it cannot order truthfully", () => {
    // Title is the notable absence: 177 of 519 imported titles carry leading or
    // trailing whitespace, which HTML collapses on screen and Postgres sorts by.
    expect(CAMPAIGN_SORT_KEYS).toEqual(["updated", "created"]);
    expect(CAMPAIGN_SORT_KEYS).not.toContain("title");
    expect(CAMPAIGN_SORT_KEYS).not.toContain("budget");
  });
});

describe("isDefaultCampaignSort", () => {
  it("recognises the default so it can be kept out of the URL", () => {
    expect(isDefaultCampaignSort({ key: "updated", dir: "desc" })).toBe(true);
    expect(isDefaultCampaignSort({ key: "updated", dir: "asc" })).toBe(false);
    expect(isDefaultCampaignSort({ key: "created", dir: "desc" })).toBe(false);
  });
});

describe("campaignOrderBy", () => {
  it("always ends with a unique tiebreaker", () => {
    for (const key of CAMPAIGN_SORT_KEYS) {
      for (const dir of ["asc", "desc"] as const) {
        const order = campaignOrderBy({ key, dir });
        expect(order[order.length - 1]).toEqual({ id: "asc" });
        expect(order.length).toBeGreaterThan(1);
      }
    }
  });

  it("orders by the column asked for, in the direction asked for", () => {
    expect(campaignOrderBy({ key: "updated", dir: "desc" })).toEqual([{ updatedAt: "desc" }, { id: "asc" }]);
    expect(campaignOrderBy({ key: "created", dir: "asc" })).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("falls back to updatedAt for a key that slipped through", () => {
    expect(campaignOrderBy({ key: "nonsense" as never, dir: "desc" })).toEqual([
      { updatedAt: "desc" },
      { id: "asc" },
    ]);
  });

  it("keeps the tiebreaker ascending whichever way the sort runs", () => {
    // The tiebreaker only has to be stable, not to follow the sort — flipping it
    // with the direction would reorder ties on every toggle for no reason.
    expect(campaignOrderBy({ key: "created", dir: "desc" })[1]).toEqual({ id: "asc" });
    expect(campaignOrderBy({ key: "created", dir: "asc" })[1]).toEqual({ id: "asc" });
  });
});
