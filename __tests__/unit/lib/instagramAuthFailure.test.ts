import {
  graphGet,
  isAuthFailure,
  InstagramAuthError,
  InstagramNoSuchAccountError,
  InstagramRateLimitError,
} from "@/lib/platforms/instagram";

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

/* Meta throttles with HTTP 400 and codes 4/17/32/613. To the roster read a null
   means "this account is personal", which would file a busy hour as a permanent
   property of the account -- and flag its handle as one nobody can find. */
describe("graphGet rate limits", () => {
  it("still returns null by default, as every existing caller expects", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(400, 4)) as unknown as typeof fetch;

    expect(await graphGet("me", { access_token: "t" })).toBeNull();
  });

  it.each([4, 17, 32, 613])("throws a rate-limit error for code %i when asked to", async (code) => {
    global.fetch = jest.fn().mockResolvedValue(graphError(400, code)) as unknown as typeof fetch;

    await expect(graphGet("me", { access_token: "t" }, undefined, { rateLimitThrows: true })).rejects.toMatchObject({
      name: "InstagramRateLimitError",
      code,
    });
  });

  it("keeps any other failure a null even when asked to throw on rate limits", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(400, 110)) as unknown as typeof fetch;

    expect(await graphGet("me", { access_token: "t" }, undefined, { rateLimitThrows: true })).toBeNull();
  });

  it("is an error of its own type", () => {
    expect(new InstagramRateLimitError(4)).toBeInstanceOf(Error);
  });
});

describe("graphGet #110, no Business or Creator account by that name", () => {
  function noSuchAccount(subcode?: number) {
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 110, error_subcode: subcode, message: "Invalid user id" } }),
    };
  }

  it("still returns null by default", async () => {
    global.fetch = jest.fn().mockResolvedValue(noSuchAccount(99)) as unknown as typeof fetch;

    expect(await graphGet("me", { access_token: "t" })).toBeNull();
  });

  it("throws its own error, carrying the subcode, when asked to", async () => {
    global.fetch = jest.fn().mockResolvedValue(noSuchAccount(99)) as unknown as typeof fetch;

    const err = await graphGet("me", { access_token: "t" }, undefined, { noSuchAccountThrows: true }).catch((e) => e);
    expect(err).toBeInstanceOf(InstagramNoSuchAccountError);
    expect(err.subcode).toBe(99);
  });

  it("leaves a missing subcode undefined rather than inventing one", async () => {
    global.fetch = jest.fn().mockResolvedValue(noSuchAccount()) as unknown as typeof fetch;

    await expect(
      graphGet("me", { access_token: "t" }, undefined, { noSuchAccountThrows: true }),
    ).rejects.toMatchObject({ subcode: undefined });
  });

  it("does not turn any other failure into it", async () => {
    global.fetch = jest.fn().mockResolvedValue(graphError(400, 100)) as unknown as typeof fetch;

    expect(await graphGet("me", { access_token: "t" }, undefined, { noSuchAccountThrows: true })).toBeNull();
  });
});
