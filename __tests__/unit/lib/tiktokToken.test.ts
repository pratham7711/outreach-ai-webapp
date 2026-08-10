const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: {
      update: (...args: any[]) => mockUpdate(...args),
    },
  },
}));

import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { encrypt, decrypt } from "@/lib/crypto/encrypt";

const ORG = "org_test_1";

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct_1",
    accessToken: encrypt("stored-access", ORG),
    refreshToken: encrypt("stored-refresh", ORG),
    tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

describe("ensureFreshTikTokToken", () => {
  const realFetch = global.fetch;
  const realKey = process.env.TIKTOK_CLIENT_KEY;
  const realSecret = process.env.TIKTOK_CLIENT_SECRET;

  beforeEach(() => {
    mockUpdate.mockReset().mockResolvedValue({});
    process.env.TIKTOK_CLIENT_KEY = "ck";
    process.env.TIKTOK_CLIENT_SECRET = "cs";
  });

  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.TIKTOK_CLIENT_KEY;
    else process.env.TIKTOK_CLIENT_KEY = realKey;
    if (realSecret === undefined) delete process.env.TIKTOK_CLIENT_SECRET;
    else process.env.TIKTOK_CLIENT_SECRET = realSecret;
  });

  it("returns the stored token without refreshing when it is still valid", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const token = await ensureFreshTikTokToken(account(), ORG);
    expect(token).toBe("stored-access");
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refreshes and persists the rotated tokens once expired", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "rotated-refresh",
        expires_in: 86400,
      }),
    }) as unknown as typeof fetch;

    const token = await ensureFreshTikTokToken(
      account({ tokenExpiry: new Date(Date.now() - 1000) }),
      ORG,
    );

    expect(token).toBe("new-access");
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const data = mockUpdate.mock.calls[0][0].data;
    expect(decrypt(data.accessToken, ORG)).toBe("new-access");
    expect(decrypt(data.refreshToken, ORG)).toBe("rotated-refresh");
    expect(data.tokenExpiry.getTime()).toBeGreaterThan(Date.now());
  });

  it("refreshes ahead of the expiry skew rather than waiting for a 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", expires_in: 86400 }),
    }) as unknown as typeof fetch;

    const token = await ensureFreshTikTokToken(
      account({ tokenExpiry: new Date(Date.now() + 60 * 1000) }),
      ORG,
    );
    expect(token).toBe("new-access");
  });

  it("keeps the existing refresh token when TikTok returns none", async () => {
    const acct = account({ tokenExpiry: new Date(Date.now() - 1000) });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "new-access", expires_in: 86400 }),
    }) as unknown as typeof fetch;

    await ensureFreshTikTokToken(acct, ORG);
    expect(mockUpdate.mock.calls[0][0].data.refreshToken).toBe(acct.refreshToken);
  });

  it("gives up when the refresh call fails, so the caller can ask for reconnection", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    const token = await ensureFreshTikTokToken(
      account({ tokenExpiry: new Date(Date.now() - 1000) }),
      ORG,
    );
    expect(token).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("gives up when an expired account has no refresh token", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const token = await ensureFreshTikTokToken(
      account({ tokenExpiry: new Date(Date.now() - 1000), refreshToken: null }),
      ORG,
    );
    expect(token).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
