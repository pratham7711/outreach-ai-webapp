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
    expect(findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", deletedAt: null });
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

  it("finds duplicates three ways and says when and how each extra row appeared", async () => {
    // cuids: the 8 characters after "c" are the creation time in base 36.
    const id = (when: string, n: number) => `c${Date.parse(when).toString(36)}${String(n).padStart(16, "0")}`;
    const old = id("2026-03-29T10:00:00Z", 1);
    const imported = id("2026-08-31T10:00:00Z", 2);
    const tiktokJane = id("2026-03-29T10:00:00Z", 3);
    const fromPost = id("2026-10-01T10:00:00Z", 4);
    findMany.mockResolvedValueOnce([
      creator({ id: old, name: "Ana", handle: "@ana", platform: "TIKTOK", profileLinks: [] }),
      creator({ id: imported, name: "Ana", handle: "ANA", platform: "TIKTOK", detail: { source: "creatorcore" }, profileLinks: [] }),
      creator({ id: tiktokJane, name: "Jane", handle: "@jane", platform: "TIKTOK", profileLinks: [link({ platform: "INSTAGRAM", handle: "jane.ig" })] }),
      creator({ id: fromPost, name: "jane.ig", handle: "jane.ig", platform: "INSTAGRAM", profileLinks: [] }),
      creator({ id: id("2026-04-01T00:00:00Z", 5), name: "Bo", handle: "@bo", platform: "YOUTUBE", profileLinks: [] }),
      creator({ id: id("2026-04-02T00:00:00Z", 6), name: "Bo B", handle: "@bo", platform: "INSTAGRAM", profileLinks: [] }),
    ]);
    const out = await auditRoster("org-1");
    expect(out.checks.duplicateHandle).toEqual({ count: 1, sample: ["tiktok @ana x2"] });
    expect(out.checks.duplicateViaProfileLink).toEqual({ count: 1, sample: ["instagram @jane.ig"] });
    expect(out.checks.sameHandleOtherPlatform.sample).toEqual(["@bo instagram+youtube"]);
    expect(out.duplicateOrigins).toEqual({
      "2026-08-31 · source:creatorcore": 1,
      "2026-10-01 · named-by-handle (post link or DM join)": 1,
    });
    expect(JSON.stringify(out)).not.toMatch(/Ana|Jane/);
  });
});
