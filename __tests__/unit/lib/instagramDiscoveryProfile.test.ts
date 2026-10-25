/**
 * @jest-environment node
 *
 * The public profile and recent posts of another professional account, read
 * through Business Discovery with the agency's own token.
 */
import {
  PROFILE_MEDIA_LIMIT,
  isInstagramUsername,
  normalizeHandle,
  parseDiscoveryProfile,
  readDiscoveryProfile,
} from "@/lib/platforms/instagramDiscoveryProfile";
import { InstagramAuthError, InstagramNoSuchAccountError } from "@/lib/platforms/instagram";

const realFetch = global.fetch;
let lastUrl: URL | null = null;

function answer(status: number, body: unknown) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    lastUrl = new URL(String(input));
    return { ok: status < 400, status, headers: new Headers(), json: async () => body } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
  lastUrl = null;
});

const BD = {
  business_discovery: {
    id: "1789",
    username: "natgeo",
    name: "National Geographic",
    biography: "Experience the world",
    website: "https://natgeo.com",
    profile_picture_url: "https://cdn/p.jpg",
    followers_count: 280000000,
    follows_count: 150,
    media_count: 30000,
    media: {
      data: [
        { id: "m1", caption: "A whale", media_type: "VIDEO", permalink: "https://instagram.com/p/a", thumbnail_url: "https://cdn/t1.jpg", timestamp: "2026-10-20T10:00:00+0000", view_count: 900, like_count: 50, comments_count: 4 },
        { id: "m2", media_type: "IMAGE", media_url: "https://cdn/m2.jpg", timestamp: "2026-10-19T10:00:00+0000", comments_count: 2 },
      ],
    },
  },
};

describe("handles", () => {
  it("normalises and validates an Instagram username", () => {
    expect(normalizeHandle(" @NatGeo/ ")).toBe("natgeo");
    expect(isInstagramUsername("nat.geo_1")).toBe(true);
    expect(isInstagramUsername("nat geo")).toBe(false);
    expect(isInstagramUsername("a){id}")).toBe(false);
  });
});

describe("parseDiscoveryProfile", () => {
  it("keeps the profile fields and leaves a count Instagram omitted absent, never 0", () => {
    const view = parseDiscoveryProfile(BD, "natgeo")!;
    expect(view).toMatchObject({
      username: "natgeo",
      name: "National Geographic",
      biography: "Experience the world",
      website: "https://natgeo.com",
      followers: 280000000,
      following: 150,
      posts: 30000,
    });
    expect(view.media[0]).toMatchObject({ id: "m1", views: 900, likes: 50, comments: 4, thumbnailUrl: "https://cdn/t1.jpg" });
    expect(view.media[1]).toMatchObject({ id: "m2", thumbnailUrl: "https://cdn/m2.jpg", comments: 2 });
    expect("likes" in view.media[1]).toBe(false);
    expect("views" in view.media[1]).toBe(false);
  });

  it("answers null when Business Discovery returned nothing", () => {
    expect(parseDiscoveryProfile({}, "x")).toBeNull();
  });
});

describe("readDiscoveryProfile", () => {
  it("asks for profile metadata and the newest posts, on behalf of the agency's own account", async () => {
    answer(200, BD);
    const view = await readDiscoveryProfile("@NatGeo", { token: "agency-token", igUserId: "agency-ig" });
    expect(view?.username).toBe("natgeo");
    expect(lastUrl!.pathname).toMatch(/\/agency-ig$/);
    expect(lastUrl!.searchParams.get("access_token")).toBe("agency-token");
    const fields = lastUrl!.searchParams.get("fields")!;
    expect(fields).toMatch(/^business_discovery\.username\(natgeo\)\{/);
    for (const f of ["name", "biography", "website", "followers_count", "follows_count", "media_count", "profile_picture_url"])
      expect(fields).toContain(f);
    expect(fields).toContain(`media.limit(${PROFILE_MEDIA_LIMIT}){`);
  });

  it("makes no call for a handle that is not an Instagram username", async () => {
    answer(200, BD);
    await expect(readDiscoveryProfile("bad){handle", { token: "t", igUserId: "i" })).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws on a refused agency token and on an account that is not professional", async () => {
    answer(400, { error: { code: 190, message: "Error validating access token" } });
    await expect(readDiscoveryProfile("natgeo", { token: "t", igUserId: "i" })).rejects.toBeInstanceOf(InstagramAuthError);
    answer(400, { error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } });
    await expect(readDiscoveryProfile("someone", { token: "t", igUserId: "i" })).rejects.toBeInstanceOf(InstagramNoSuchAccountError);
  });
});
