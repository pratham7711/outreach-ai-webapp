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

import { readInstagramFollowersFromPost } from "@/lib/platforms/instagramCreatorFallback";

const URL = "https://www.instagram.com/reel/DcQFHR5pdYw/";

describe("readInstagramFollowersFromPost", () => {
  beforeEach(() => mockFetchEmbed.mockReset());

  it("reads the follower count off the creator's own post", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat", authorFollowers: 113932 });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toEqual({
      ok: true,
      profile: { followersCount: 113932, postsCount: 0, avgViews: 0, sampledPosts: 0 },
    });
  });

  it("matches the handle case-insensitively and through a leading @", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "@IamSwarat", authorFollowers: 10 });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toMatchObject({ ok: true });
  });

  it("refuses a post owned by somebody else", async () => {
    /* A Post row filed against the wrong creator would otherwise hand this
       creator a stranger's follower count. */
    mockFetchEmbed.mockResolvedValue({ authorHandle: "someone_else", authorFollowers: 999999 });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toBeNull();
  });

  it("refuses a post whose owner the embed did not name", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: undefined, authorFollowers: 500 });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toBeNull();
  });

  it("reports nothing rather than a zero when the count is absent", async () => {
    /* Zero followers and an unread follower count are different facts, and the
       series cannot tell them apart once written. */
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat" });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toBeNull();
  });

  it("keeps a genuine zero out by type, not by truthiness", async () => {
    mockFetchEmbed.mockResolvedValue({ authorHandle: "iamswarat", authorFollowers: 0 });
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toMatchObject({
      ok: true,
      profile: { followersCount: 0 },
    });
  });

  it("returns null for a deleted post, leaving the platform's own reason intact", async () => {
    mockFetchEmbed.mockResolvedValue(null);
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toBeNull();
  });

  it("does not throw when the embed read does", async () => {
    mockFetchEmbed.mockRejectedValue(new Error("socket hang up"));
    await expect(readInstagramFollowersFromPost("iamswarat", URL)).resolves.toBeNull();
  });
});
