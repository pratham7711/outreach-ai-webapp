/**
 * How the roster's Instagram read files a failure decides whether the account
 * is retried next hour or shown to the agency as a handle nobody can find, so
 * a throttle must never come out as "personal account".
 */
jest.mock("@/lib/platforms/instagramBusinessDiscovery", () => ({
  businessDiscoveryToken: jest.fn(async () => "tok"),
  fetchInstagramProfile: jest.fn(),
}));

import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import { fetchInstagramProfile } from "@/lib/platforms/instagramBusinessDiscovery";
import { InstagramRateLimitError } from "@/lib/platforms/instagram";

const fetchProfile = fetchInstagramProfile as jest.Mock;

describe("readCreatorProfile on Instagram", () => {
  beforeEach(() => fetchProfile.mockReset());

  it("asks Business Discovery to throw on a rate limit", async () => {
    fetchProfile.mockResolvedValue(null);
    await readCreatorProfile("INSTAGRAM", "someone");
    expect(fetchProfile.mock.calls[0][4]).toEqual({ rateLimitThrows: true });
  });

  it("files a Graph throttle as rate-limited, to be retried", async () => {
    fetchProfile.mockRejectedValue(new InstagramRateLimitError(4));
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toMatchObject({ ok: false, reason: "rate-limited" });
  });

  it("files no answer at all as a personal account, which may also be a misspelt handle", async () => {
    fetchProfile.mockResolvedValue(null);
    await expect(readCreatorProfile("INSTAGRAM", "someone")).resolves.toEqual({ ok: false, reason: "not-a-professional-account" });
  });

  /* Plan A4: the account's own id rides in the same response, so it costs nothing. */
  it("hands on the account's Instagram user id with the figures", async () => {
    fetchProfile.mockResolvedValue({ username: "someone", igUserId: "17841400000000001", followersCount: 900, recentPosts: [] });
    const res = await readCreatorProfile("INSTAGRAM", "someone");
    expect(res).toMatchObject({ ok: true, profile: { followersCount: 900, accountId: "17841400000000001" } });
  });
});
