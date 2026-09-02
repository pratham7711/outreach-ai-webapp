import { graphGet, isAuthFailure, InstagramAuthError } from "@/lib/platforms/instagram";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

function graphError(status: number, code?: number) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: "bad token" } }),
  };
}

describe("isAuthFailure", () => {
  it("treats 401 and 403 as auth failures whatever the code", () => {
    expect(isAuthFailure(401, undefined)).toBe(true);
    expect(isAuthFailure(403, undefined)).toBe(true);
  });

  it("treats Graph codes 190 and 102 as auth failures", () => {
    expect(isAuthFailure(400, 190)).toBe(true);
    expect(isAuthFailure(400, 102)).toBe(true);
  });

  it("does not treat a rate limit or a server fault as an auth failure", () => {
    expect(isAuthFailure(429, 4)).toBe(false);
    expect(isAuthFailure(500, undefined)).toBe(false);
  });
});

describe("graphGet", () => {
  it("throws rather than returning null when the token is rejected", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(400, 190)) as unknown as typeof fetch;

    // The whole point: this case must not be indistinguishable from an empty result.
    await expect(graphGet("me/accounts", { access_token: "dead" })).rejects.toThrow(
      InstagramAuthError,
    );
  });

  it("carries the status and Graph code on the error", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(403, 200)) as unknown as typeof fetch;

    await expect(graphGet("me/accounts", { access_token: "t" })).rejects.toMatchObject({
      status: 403,
      code: 200,
    });
  });

  it("still returns null for a non-auth failure", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(500)) as unknown as typeof fetch;

    expect(await graphGet("me/accounts", { access_token: "t" })).toBeNull();
  });

  it("returns null when the request throws, without inventing an auth failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;

    expect(await graphGet("me/accounts", { access_token: "t" })).toBeNull();
  });

  it("returns the body on success", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "1" }] }) }) as unknown as typeof fetch;

    expect(await graphGet("me/accounts", { access_token: "t" })).toEqual({ data: [{ id: "1" }] });
  });
});
