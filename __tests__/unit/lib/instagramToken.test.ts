import {
  decryptInstagramToken,
  ensureFreshInstagramToken,
  getInstagramAccountForCreator,
  instagramLookupHandle,
} from "@/lib/platforms/instagramToken";

jest.mock("@/lib/db", () => ({
  db: { creatorSocialAccount: { update: jest.fn() }, creator: { findUnique: jest.fn() } },
}));
jest.mock("@/lib/crypto/encrypt", () => ({
  decrypt: jest.fn((value: string) => `plain:${value}`),
  encrypt: jest.fn((value: string) => `enc:${value}`),
}));
jest.mock("@/lib/platforms/instagram", () => ({
  exchangeForLongLivedToken: jest.fn(),
}));

import { db } from "@/lib/db";
import { exchangeForLongLivedToken } from "@/lib/platforms/instagram";

const mockExchange = exchangeForLongLivedToken as jest.Mock;
const mockUpdate = (db as any).creatorSocialAccount.update as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
function account(expiryMs: number | null) {
  return {
    id: "acct-1",
    accessToken: "stored",
    tokenExpiry: expiryMs === null ? null : new Date(Date.now() + expiryMs),
  };
}

beforeEach(() => jest.clearAllMocks());

describe("decryptInstagramToken", () => {
  it("treats an expired token as absent rather than returning it", () => {
    expect(decryptInstagramToken("stored", "org-1", new Date(Date.now() - 1000))).toBeUndefined();
  });

  it("returns a token that is still comfortably valid", () => {
    expect(decryptInstagramToken("stored", "org-1", new Date(Date.now() + 30 * DAY))).toBe(
      "plain:stored",
    );
  });

  it("rejects a token inside the expiry skew window", () => {
    expect(decryptInstagramToken("stored", "org-1", new Date(Date.now() + 60_000))).toBeUndefined();
  });

  it("accepts a token with no recorded expiry", () => {
    expect(decryptInstagramToken("stored", "org-1", null)).toBe("plain:stored");
  });
});

describe("ensureFreshInstagramToken", () => {
  it("returns nothing for a missing account", async () => {
    expect(await ensureFreshInstagramToken(null, "org-1")).toBeUndefined();
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("does not attempt an exchange once the token has lapsed", async () => {
    expect(await ensureFreshInstagramToken(account(-1000), "org-1")).toBeUndefined();
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("uses a healthy token without exchanging", async () => {
    expect(await ensureFreshInstagramToken(account(30 * DAY), "org-1")).toBe("plain:stored");
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("exchanges and persists when the token is nearing expiry", async () => {
    const expiresAt = new Date(Date.now() + 60 * DAY);
    mockExchange.mockResolvedValue({ accessToken: "fresh", expiresAt });

    expect(await ensureFreshInstagramToken(account(3 * DAY), "org-1")).toBe("fresh");
    expect(mockExchange).toHaveBeenCalledWith("plain:stored");
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: { accessToken: "enc:fresh", tokenExpiry: expiresAt },
    });
  });

  it("keeps serving the existing token when the exchange fails", async () => {
    mockExchange.mockResolvedValue(null);

    expect(await ensureFreshInstagramToken(account(3 * DAY), "org-1")).toBe("plain:stored");
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("instagramLookupHandle", () => {
  const REEL = "https://www.instagram.com/reel/AAA1/";

  it("takes the author named in the post's own link over everything else", () => {
    for (const path of ["reel", "reels", "p", "tv"]) {
      expect(
        instagramLookupHandle({
          postUrl: `https://www.instagram.com/author.name/${path}/AAA1/`,
          connected: "connected",
          profileLink: "linked",
          creatorHandle: "primary",
          creatorPlatform: "INSTAGRAM",
        }),
      ).toBe("author.name");
    }
  });

  it("then the connected account, then the profile link", () => {
    expect(instagramLookupHandle({ postUrl: REEL, connected: "connected", profileLink: "linked" })).toBe("connected");
    expect(instagramLookupHandle({ postUrl: REEL, profileLink: "linked", creatorHandle: "tt" })).toBe("linked");
  });

  it("uses the creator's handle only when Instagram is their platform", () => {
    expect(instagramLookupHandle({ postUrl: REEL, creatorHandle: "ig_name", creatorPlatform: "INSTAGRAM" })).toBe("ig_name");
    expect(instagramLookupHandle({ postUrl: REEL, creatorHandle: "tt_name", creatorPlatform: "TIKTOK" })).toBeUndefined();
    expect(instagramLookupHandle({ postUrl: REEL, creatorHandle: "unknown", creatorPlatform: null })).toBeUndefined();
  });
});

describe("getInstagramAccountForCreator", () => {
  const mockFindCreator = (db as any).creator.findUnique as jest.Mock;

  it("does not hand a TikTok-first creator's TikTok handle to Instagram", async () => {
    mockFindCreator.mockResolvedValue({ handle: "tt_name", platform: "TIKTOK", profileLinks: [], socialAccounts: [] });

    const out = await getInstagramAccountForCreator("c-1", "org-1", "https://www.instagram.com/reel/AAA1/");

    expect(out.handle).toBeUndefined();
  });

  it("reads the Instagram account on the creator's profile", async () => {
    mockFindCreator.mockResolvedValue({
      handle: "tt_name",
      platform: "TIKTOK",
      profileLinks: [{ handle: "ig_name" }],
      socialAccounts: [],
    });

    const out = await getInstagramAccountForCreator("c-1", "org-1", "https://www.instagram.com/reel/AAA1/");

    expect(out.handle).toBe("ig_name");
    expect(mockFindCreator.mock.calls[0][0].select.profileLinks.where).toEqual({ platform: "INSTAGRAM" });
  });
});
