/**
 * @jest-environment node
 *
 * listFilters imports Prisma for its where-input types, which drags the Prisma
 * runtime in; that runtime needs TextEncoder and so cannot load under jsdom.
 */
import { readCampaignFilters, campaignWhere, countCampaignFilters } from "@/lib/listFilters";

/**
 * Covers the Tags and Team Member filters added for the campaigns list.
 *
 * The tag filter now runs through `tagLinks` — the org's own tag definitions
 * from Settings → General, joined to the campaign and matched on the tag's
 * *name*. It used to read a free-string `tags` join table that nothing ever
 * wrote; that table is still in the schema but is neither read nor written.
 * Matching on the name rather than the id is deliberate: a shared filter URL
 * stays readable, and one that was shared before the switch keeps working.
 *
 * The shapes were confirmed against the real database once (a tag and a team
 * member on one campaign, both filters returning exactly that campaign, an
 * unknown tag returning nothing), and this pins that behaviour without needing
 * a database to run.
 */
describe("campaign tag and team-member filters", () => {
  const ORG = "org-1";

  it("parses both as comma-joined multi-selects", () => {
    const f = readCampaignFilters({ tags: "launch, q3 ,launch", teamMemberIds: "u1,u2" });
    // Deduped and trimmed by csvParam, same as the other multi-selects.
    expect(f.tags).toEqual(["launch", "q3"]);
    expect(f.teamMemberIds).toEqual(["u1", "u2"]);
  });

  it("defaults both to empty rather than undefined", () => {
    // campaignWhere reads .length on both, so an absent param must still be an
    // array — including on the malformed-URL fallback path.
    const f = readCampaignFilters({});
    expect(f.tags).toEqual([]);
    expect(f.teamMemberIds).toEqual([]);
    expect(readCampaignFilters({ createdFrom: "not-a-date" }).tags).toEqual([]);
  });

  it("emits no tag or team clause when neither is set", () => {
    const where = campaignWhere(ORG, readCampaignFilters({}));
    expect(where).not.toHaveProperty("tagLinks");
    expect(where).not.toHaveProperty("teamMembers");
  });

  it("narrows through the join tables, matching ANY of the selected values", () => {
    const where = campaignWhere(ORG, readCampaignFilters({ tags: "launch,q3", teamMemberIds: "u1" }));
    // Through the link table, onto the tag definition, matched by name.
    expect(where.tagLinks).toEqual({ some: { tag: { name: { in: ["launch", "q3"] } } } });
    expect(where.teamMembers).toEqual({ some: { userId: { in: ["u1"] } } });
    // Still scoped to the org and to live rows — a filter must not widen either.
    expect(where.orgId).toBe(ORG);
    expect(where.deletedAt).toBeNull();
  });

  it("keeps an unrecognised tag as a clause that matches nothing", () => {
    // The failure mode worth guarding: dropping an unknown tag would make the
    // filter fall open and return every campaign, reading as "no matches found"
    // when it is really "filter ignored".
    const where = campaignWhere(ORG, readCampaignFilters({ tags: "__nope__" }));
    expect(where.tagLinks).toEqual({ some: { tag: { name: { in: ["__nope__"] } } } });
  });

  it("counts each as one filter for the drawer badge", () => {
    const none = countCampaignFilters(readCampaignFilters({}));
    expect(countCampaignFilters(readCampaignFilters({ tags: "a,b" }))).toBe(none + 1);
    expect(countCampaignFilters(readCampaignFilters({ teamMemberIds: "u1" }))).toBe(none + 1);
    expect(countCampaignFilters(readCampaignFilters({ tags: "a", teamMemberIds: "u1" }))).toBe(none + 2);
  });
});
