import {
  deletionConfirmationCode,
  isDeletionConfirmationCode,
  parseSignedRequest,
  signRequest,
  verifyMetaSignedRequest,
} from "@/lib/oauth/metaSignedRequest";

const ENV_KEYS = [
  "INSTAGRAM_CLIENT_ID",
  "INSTAGRAM_CLIENT_SECRET",
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "THREADS_CLIENT_ID",
  "THREADS_CLIENT_SECRET",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("parseSignedRequest", () => {
  it("round-trips a payload signed the way Meta signs it", () => {
    const sr = signRequest({ user_id: "17841400000000000", issued_at: 1700000000 }, "s3cret");
    expect(parseSignedRequest(sr, "s3cret")).toEqual({
      algorithm: "HMAC-SHA256",
      user_id: "17841400000000000",
      issued_at: 1700000000,
    });
  });

  it("rejects the wrong secret", () => {
    const sr = signRequest({ user_id: "u1" }, "right");
    expect(parseSignedRequest(sr, "wrong")).toBeNull();
  });

  it("rejects a payload edited after signing", () => {
    const sr = signRequest({ user_id: "u1" }, "s");
    const [sig] = sr.split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "u2" }))
      .toString("base64")
      .replace(/=+$/, "");
    expect(parseSignedRequest(`${sig}.${forged}`, "s")).toBeNull();
  });

  it("rejects a malformed envelope without throwing", () => {
    expect(parseSignedRequest("", "s")).toBeNull();
    expect(parseSignedRequest("nodot", "s")).toBeNull();
    expect(parseSignedRequest(".payloadonly", "s")).toBeNull();
    expect(parseSignedRequest("sigonly.", "s")).toBeNull();
    expect(parseSignedRequest("!!!.@@@", "s")).toBeNull();
  });

  it("rejects an algorithm it did not sign with", () => {
    // Signature is valid; only the declared algorithm is wrong.
    const encoded = Buffer.from(JSON.stringify({ algorithm: "HMAC-MD5", user_id: "u1" }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const { createHmac } = jest.requireActual("crypto") as typeof import("crypto");
    const sig = createHmac("sha256", "s")
      .update(encoded)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(parseSignedRequest(`${sig}.${encoded}`, "s")).toBeNull();
  });
});

describe("verifyMetaSignedRequest", () => {
  it("returns null when no Meta platform is configured", () => {
    expect(verifyMetaSignedRequest(signRequest({ user_id: "u" }, "x"))).toBeNull();
  });

  it("maps a shared Instagram/Facebook app to both platforms", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "shared";
    // No FACEBOOK_* set — Facebook falls back to the Instagram pair.
    const out = verifyMetaSignedRequest(signRequest({ user_id: "u1" }, "shared"));
    expect(out?.payload.user_id).toBe("u1");
    expect(out?.platforms.sort()).toEqual(["facebook", "instagram"]);
  });

  it("keeps Threads separate when it has its own secret", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "meta-secret";
    process.env.THREADS_CLIENT_ID = "th-id";
    process.env.THREADS_CLIENT_SECRET = "threads-secret";
    const threads = verifyMetaSignedRequest(signRequest({ user_id: "t1" }, "threads-secret"));
    expect(threads?.platforms).toEqual(["threads"]);
    const meta = verifyMetaSignedRequest(signRequest({ user_id: "m1" }, "meta-secret"));
    expect(meta?.platforms.sort()).toEqual(["facebook", "instagram"]);
  });

  it("returns null when the request was signed by an unknown app", () => {
    process.env.INSTAGRAM_CLIENT_ID = "ig-id";
    process.env.INSTAGRAM_CLIENT_SECRET = "meta-secret";
    expect(verifyMetaSignedRequest(signRequest({ user_id: "u" }, "someone-else"))).toBeNull();
  });
});

describe("deletion confirmation codes", () => {
  it("recognises a code it issued and nothing else", () => {
    process.env.THREADS_CLIENT_ID = "th-id";
    process.env.THREADS_CLIENT_SECRET = "threads-secret";
    const code = deletionConfirmationCode("12345", "threads-secret");
    expect(code.startsWith("12345-")).toBe(true);
    expect(isDeletionConfirmationCode(code)).toBe(true);
    expect(isDeletionConfirmationCode("12345-0000000000000000")).toBe(false);
    expect(isDeletionConfirmationCode("garbage")).toBe(false);
    expect(isDeletionConfirmationCode("")).toBe(false);
  });

  it("is deterministic for the same user and secret", () => {
    expect(deletionConfirmationCode("u", "s")).toBe(deletionConfirmationCode("u", "s"));
    expect(deletionConfirmationCode("u", "s")).not.toBe(deletionConfirmationCode("u", "t"));
  });
});
