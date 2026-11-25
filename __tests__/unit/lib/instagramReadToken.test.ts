/**
 * @jest-environment node
 *
 * The Page token is preferred for IG-user-id reads and the user token is the
 * fallback; a lapsed user token no longer ends the read while a Page token is
 * held.
 */
jest.mock("@/lib/platforms/instagram", () => {
  class InstagramAuthError extends Error {}
  return { InstagramAuthError };
});
jest.mock("@/lib/platforms/instagramToken", () => ({ ensureFreshInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/connectionHealth", () => ({
  connectionHealthFor: jest.fn(),
  decryptPageToken: jest.fn((h: { pageAccessToken?: string | null } | undefined) => (h?.pageAccessToken ? `plain:${h.pageAccessToken}` : undefined)),
}));

import { InstagramAuthError } from "@/lib/platforms/instagram";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { connectionHealthFor } from "@/lib/platforms/connectionHealth";
import { instagramReadTokens, withReadToken } from "@/lib/platforms/instagramReadToken";

const authError = () => new (InstagramAuthError as unknown as new (m: string) => Error)("auth");
const mockUser = ensureFreshInstagramToken as jest.Mock;
const mockHealth = connectionHealthFor as jest.Mock;
const account = { id: "a", accessToken: "x", tokenExpiry: null, platformUserId: "ig-1" };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.mockResolvedValue("user-tok");
  mockHealth.mockResolvedValue(new Map([["a", { pageAccessToken: "sealed" }]]));
});

describe("instagramReadTokens", () => {
  it("returns the Page token beside the user token", async () => {
    expect(await instagramReadTokens(account, "org")).toEqual({ page: "plain:sealed", user: "user-tok" });
  });
  it("still returns the Page token once the user token has lapsed", async () => {
    mockUser.mockResolvedValue(undefined);
    expect(await instagramReadTokens(account, "org")).toEqual({ page: "plain:sealed", user: undefined });
  });
  it("falls back to the user token when no Page token is stored", async () => {
    mockHealth.mockResolvedValue(new Map());
    expect(await instagramReadTokens(account, "org")).toEqual({ page: undefined, user: "user-tok" });
  });
  it("uses only the user token when the IG user id is unknown (me/accounts needs it)", async () => {
    expect(await instagramReadTokens({ ...account, platformUserId: null }, "org")).toEqual({ user: "user-tok" });
    expect(mockHealth).not.toHaveBeenCalled();
  });
  it("returns nothing for no account", async () => {
    expect(await instagramReadTokens(null, "org")).toEqual({});
  });
});

describe("withReadToken", () => {
  it("reads with the Page token first and stops there on success", async () => {
    const read = jest.fn().mockResolvedValue("ok");
    expect(await withReadToken({ page: "p", user: "u" }, read)).toBe("ok");
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("p");
  });
  it("retries with the user token when Meta rejects the Page token", async () => {
    const read = jest.fn().mockRejectedValueOnce(authError()).mockResolvedValueOnce("ok");
    expect(await withReadToken({ page: "p", user: "u" }, read)).toBe("ok");
    expect(read.mock.calls.map((c) => c[0])).toEqual(["p", "u"]);
  });
  it("retries with the user token when the Page-token read comes back empty", async () => {
    const read = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(["media"]);
    expect(await withReadToken({ page: "p", user: "u" }, read)).toEqual(["media"]);
  });
  it("rethrows an auth error when there is no user token to fall back to", async () => {
    const read = jest.fn().mockRejectedValue(authError());
    await expect(withReadToken({ page: "p" }, read)).rejects.toBeInstanceOf(InstagramAuthError);
  });
  it("does not swallow a non-auth error", async () => {
    const read = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(withReadToken({ page: "p", user: "u" }, read)).rejects.toThrow("boom");
  });
  it("uses the user token alone when there is no Page token, and nothing when neither", async () => {
    const read = jest.fn().mockResolvedValue("ok");
    expect(await withReadToken({ user: "u" }, read)).toBe("ok");
    expect(read).toHaveBeenCalledWith("u");
    expect(await withReadToken({}, read)).toBeUndefined();
  });
});
