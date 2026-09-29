/**
 * @jest-environment node
 */
const findMany = jest.fn();
jest.mock("@/lib/db", () => ({ db: { creator: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { auditRoster } from "@/lib/creators/rosterAudit";

const link = (over: Record<string, unknown> = {}) => ({
  platform: "TIKTOK",
  handle: "someone",
  followersCount: 17300,
  averageViews: 2000,
  isPrimary: true,
  refreshError: null,
  ...over,
});

const creator = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "Some One",
  handle: "@someone",
  contactEmail: null,
  rate: 50,
  avatarUrl: null,
  avatar: { fetchedAt: new Date() },
  detail: { country: "Indonesia", audienceCountry: "USA" },
  profileLinks: [link()],
  ...over,
});

beforeEach(() => findMany.mockReset());

describe("auditRoster", () => {
  it("scopes the read to the org and finds nothing wrong with a clean creator", async () => {
    findMany.mockResolvedValueOnce([creator()]);
    const out = await auditRoster("org-1");
    expect(findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1" });
    expect(Object.values(out.checks).every((c) => c.count === 0)).toBe(true);
    expect(out).toMatchObject({ creators: 1, withPicture: 1, links: { total: 1, byPlatform: { TIKTOK: 1 } } });
  });

  it("flags the values the first import misread", async () => {
    findMany.mockResolvedValueOnce([
      creator({ handle: "@a", profileLinks: [link({ handle: "a", followersCount: 17 })] }),
      creator({ handle: "@b", profileLinks: [link({ handle: "b", followersCount: 31_200_000 })] }),
      creator({ handle: "@c", detail: { country: "IndonÉSia", audienceCountry: null } }),
      creator({ handle: "@d", profileLinks: [link({ handle: "d", averageViews: 391.9 })] }),
    ]);
    const { checks } = await auditRoster("org-1");
    expect(checks.linkFollowersUnder1000).toEqual({ count: 1, sample: ["tiktok @a 17"] });
    expect(checks.linkFollowersOver20M.sample).toEqual(["tiktok @b 31200000"]);
    expect(checks.countryMixedCase.sample).toEqual(["@c IndonÉSia"]);
    expect(checks.linkCountHasFraction.sample).toEqual(["tiktok @d"]);
  });

  it("flags placeholders, junk handles, missing links and pictures", async () => {
    findMany.mockResolvedValueOnce([
      creator({ name: "Name", handle: "@@x" }),
      creator({ handle: "@flurrex.x", profileLinks: [link({ handle: "tiktok.com/flurrex.x" })] }),
      creator({ handle: "@y", profileLinks: [] }),
      creator({ handle: "@z", avatar: null, profileLinks: [link({ isPrimary: false })] }),
      creator({ handle: "@w", profileLinks: [link({ platform: "INSTAGRAM", refreshError: "no-such-account: gone" })] }),
    ]);
    const { checks } = await auditRoster("org-1");
    expect(checks.nameMissingOrPlaceholder.count).toBe(1);
    expect(checks.handleDoubleAt.sample).toEqual(["@@x"]);
    expect(checks.handleNotAHandle.sample).toEqual(["tiktok @tiktok.com/flurrex.x"]);
    expect(checks.noProfileLinks.sample).toEqual(["@y"]);
    expect(checks.noPrimaryLink.sample).toEqual(["@z"]);
    expect(checks.pictureMissing.sample).toEqual(["@z"]);
    expect(checks.handleProblem.sample).toEqual(["instagram @someone"]);
  });

  it("counts creators sharing an email without ever returning the email", async () => {
    findMany.mockResolvedValueOnce([
      creator({ handle: "@one", contactEmail: "Same@Mail.com" }),
      creator({ handle: "@two", contactEmail: "same@mail.com " }),
      creator({ handle: "@three", contactEmail: "other@mail.com" }),
    ]);
    const out = await auditRoster("org-1");
    expect(out.checks.duplicateEmail).toEqual({ count: 2, sample: ["@one", "@two"] });
    expect(out.withEmail).toBe(3);
    expect(JSON.stringify(out)).not.toMatch(/mail\.com/i);
  });
});
