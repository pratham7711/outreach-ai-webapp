/**
 * @jest-environment node
 *
 * node, not jsdom: listFilters imports the Prisma client for its generated
 * types, and the Prisma runtime needs TextEncoder, which jsdom does not provide.
 */
import { creatorWhere, readCreatorFilters } from "@/lib/listFilters";
import { CREATOR_PLATFORM_TABS } from "@/lib/creators/platformTabs";

const anyAccountOn = (platforms: string[]) => ({
  OR: [{ platform: { in: platforms } }, { profileLinks: { some: { platform: { in: platforms } } } }],
});

describe("creatorWhere: the platform tab", () => {
  it("lists every creator with an account on the platform, not only those whose first account is there", () => {
    // Measured on prod 2026-10-03: 428 creators had Instagram as their first
    // account and 863 had an Instagram account at all, so the tab hid 435 of
    // them -- the roster's own chips showed those accounts on every row.
    const where = creatorWhere("org-1", readCreatorFilters({ platform: "INSTAGRAM" }), { roster: true });
    expect(where.AND).toContainEqual(anyAccountOn(["INSTAGRAM"]));
    expect(where).not.toHaveProperty("platform");
  });

  it("is the same rule as the drawer's 'Has an account on' filter", () => {
    const tab = creatorWhere("org-1", readCreatorFilters({ platform: "TIKTOK" }), { roster: true });
    const drawer = creatorWhere("org-1", readCreatorFilters({ accounts: "TIKTOK" }), { roster: true });
    expect(tab.AND).toEqual(drawer.AND);
  });

  it("falls back to the creator's own platform before the roster tables exist", () => {
    const where = creatorWhere("org-1", readCreatorFilters({ platform: "YOUTUBE" }), { roster: false });
    expect(where.AND).toContainEqual({ platform: { in: ["YOUTUBE"] } });
  });

  it("keeps the search when a tab is picked", () => {
    // Both are ORs; the tab's sits inside AND so it cannot overwrite the search's.
    const where = creatorWhere("org-1", readCreatorFilters({ platform: "INSTAGRAM", q: "ma" }), { roster: true });
    expect(where.AND).toContainEqual(anyAccountOn(["INSTAGRAM"]));
    expect(where.OR).toEqual(expect.arrayContaining([{ name: { contains: "ma", mode: "insensitive" } }]));
  });

  it("stays scoped to the org and to live creators", () => {
    const where = creatorWhere("org-1", readCreatorFilters({ platform: "TIKTOK" }), { roster: true });
    expect(where.orgId).toBe("org-1");
    expect(where.deletedAt).toBeNull();
  });
});

describe("CREATOR_PLATFORM_TABS", () => {
  it("names the platforms the Creators page has a tab for", () => {
    expect([...CREATOR_PLATFORM_TABS]).toEqual(["INSTAGRAM", "YOUTUBE", "TIKTOK", "TWITTER"]);
  });
});
