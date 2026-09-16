/**
 * lib/platforms/instagramCreatorFallback — the credential-free rung that gives
 * a tracked Instagram creator a follower count when Business Discovery will
 * not.
 *
 * The rung writes into a follower SERIES, which nobody re-checks by eye once
 * it is drawn, so the tests that matter are the ones about refusing: a post
 * that belongs to somebody else, and a count that is not a count.
 */
const mockFetchEmbed = jest.fn();
jest.mock("@/lib/platforms/instagramEmbed", () => ({
  fetchInstagramEmbedPost: (...a: unknown[]) => mockFetchEmbed(...a),
}));

import {
  describeInstagramPostReads,
  readInstagramPostForFollowers,
} from "@/lib/platforms/instagramCreatorFallback";

const URL = "https://www.instagram.com/reel/DcQFHR5pdYw/";

describe("readInstagramPostForFollowers", () => {
  beforeEach(() => mockFetchEmbed.mockReset());

  it("reads the follower count off the creator's own post", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat", authorFollowers: 113932 });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: true,
      profile: { followersCount: 113932, postsCount: 0, avgViews: 0, sampledPosts: 0 },
    });
  });

  it("matches the handle case-insensitively and through a leading @", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "@IamSwarat", authorFollowers: 10 });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toMatchObject({ ok: true });
  });

  it("refuses a post owned by somebody else", async () => {
    /* A Post row filed against the wrong creator would otherwise hand this
       creator a stranger's follower count. */
    mockFetchEmbed.mockResolvedValue({ authorHandle: "someone_else", authorFollowers: 999999 });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: false,
      why: "owner-mismatch",
      owner: "someone_else",
    });
  });

  it("refuses a post whose owner the embed did not name", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: undefined, authorFollowers: 500 });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: false,
      why: "owner-mismatch",
    });
  });

  it("reports nothing rather than a zero when the count is absent", async () => {
    /* Zero followers and an unread follower count are different facts, and the
       series cannot tell them apart once written. */
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat" });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: false,
      why: "no-count",
    });
  });

  it("keeps a genuine zero out by type, not by truthiness", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat", authorFollowers: 0 });
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toMatchObject({
      ok: true,
      profile: { followersCount: 0 },
    });
  });

  it("reports a deleted post as unavailable rather than as this creator's failure", async () => {
    mockFetchEmbed.mockResolvedValue(null);
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: false,
      why: "post-unavailable",
    });
  });

  it("does not throw when the embed read does", async () => {
    mockFetchEmbed.mockRejectedValue(new Error("socket hang up"));
    await expect(readInstagramPostForFollowers("iamswarat", URL)).resolves.toEqual({
      ok: false,
      why: "post-unavailable",
    });
  });
});

describe("describeInstagramPostReads", () => {
  const unavailable = { ok: false as const, why: "post-unavailable" as const };
  const mismatch = (owner: string) => ({
    ok: false as const,
    why: "owner-mismatch" as const,
    owner,
  });

  it("says no post is on record when the walk had nothing to read", () => {
    expect(describeInstagramPostReads([])).toBe(
      "no post of theirs is on record to read a follower count from"
    );
  });

  it("names the other account when every readable post belongs to it", () => {
    expect(describeInstagramPostReads([mismatch("autoclubhq"), mismatch("autoclubhq")])).toBe(
      "2 post(s) tried; every readable one is owned by @autoclubhq — the handle may have been renamed"
    );
  });

  it("does not call it a rename when the readable posts disagree on the owner", () => {
    const note = describeInstagramPostReads([mismatch("autoclubhq"), mismatch("carvaulthq")]);
    expect(note).toContain("@autoclubhq, @carvaulthq");
    expect(note).not.toContain("renamed");
  });

  it("reports deletion when nothing still stands", () => {
    expect(describeInstagramPostReads([unavailable, unavailable, unavailable])).toBe(
      "3 post(s) tried; none is still available on Instagram"
    );
  });

  it("keeps the rename reading off a mixed walk, but still names the owner seen", () => {
    const note = describeInstagramPostReads([unavailable, mismatch("gumenedits")]);
    expect(note).toBe("2 post(s) tried; none answered for this handle (saw @gumenedits)");
  });

  it("falls back to the plainest note when a post rendered without a count", () => {
    expect(describeInstagramPostReads([{ ok: false, why: "no-count" }])).toBe(
      "1 post(s) tried; none carried a follower count"
    );
  });
});
