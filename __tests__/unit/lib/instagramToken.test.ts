import {
  decryptInstagramToken,
  ensureFreshInstagramToken,
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
