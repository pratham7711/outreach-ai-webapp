import {
  parseTikTokWebhookBody,
  signTikTokWebhook,
  tiktokWebhookSecrets,
  verifyTikTokSignature,
  TIKTOK_SIGNATURE_TOLERANCE_SEC,
} from "@/lib/oauth/tiktokWebhook";

/**
 * TikTok-Signature: t=<unix>,s=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>.
 * The scheme is TikTok's documented one; it is not written anywhere in the
 * repo, which is why every edge of it is pinned here.
 */
const body = JSON.stringify({
  client_key: "ck",
  event: "authorization.removed",
  create_time: 1_700_000_000,
  user_openid: "open-id-fake-1",
  content: JSON.stringify({ reason: 1 }),
});
const NOW = 1_700_000_100;

describe("verifyTikTokSignature", () => {
  it("accepts a signature made the way TikTok makes it", () => {
    const header = signTikTokWebhook(body, "secret", NOW);
    expect(verifyTikTokSignature(header, body, ["secret"], NOW)).toBe(true);
  });

  it("accepts the header's parts in either order and with spaces", () => {
    const [t, s] = signTikTokWebhook(body, "secret", NOW).split(",");
    expect(verifyTikTokSignature(`${s}, ${t}`, body, ["secret"], NOW)).toBe(true);
  });

  it("accepts any of several secrets (production and sandbox apps)", () => {
    const header = signTikTokWebhook(body, "sandbox-secret", NOW);
    expect(verifyTikTokSignature(header, body, ["prod-secret", "sandbox-secret"], NOW)).toBe(true);
  });

  it("rejects the wrong secret", () => {
    const header = signTikTokWebhook(body, "not-ours", NOW);
    expect(verifyTikTokSignature(header, body, ["secret"], NOW)).toBe(false);
  });

  it("rejects a body edited after signing (a different open_id)", () => {
    const header = signTikTokWebhook(body, "secret", NOW);
    const forged = body.replace("open-id-fake-1", "open-id-fake-2");
    expect(verifyTikTokSignature(header, forged, ["secret"], NOW)).toBe(false);
  });

  it("rejects a re-dated signature: the timestamp is inside the MAC", () => {
    const header = signTikTokWebhook(body, "secret", NOW);
    const redated = header.replace(`t=${NOW}`, `t=${NOW + 5}`);
    expect(verifyTikTokSignature(redated, body, ["secret"], NOW)).toBe(false);
  });

  it("rejects a signature older than the tolerance, so a captured request cannot be replayed", () => {
    const old = NOW - TIKTOK_SIGNATURE_TOLERANCE_SEC - 1;
    const header = signTikTokWebhook(body, "secret", old);
    expect(verifyTikTokSignature(header, body, ["secret"], NOW)).toBe(false);
  });

  it.each([
    ["no header", null],
    ["empty", ""],
    ["no s", `t=${NOW}`],
    ["no t", "s=abcdef"],
    ["non-numeric t", "t=abc,s=abcdef"],
    ["non-hex s", `t=${NOW},s=zz`],
  ])("rejects a malformed header (%s) without throwing", (_label, header) => {
    expect(verifyTikTokSignature(header, body, ["secret"], NOW)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    const header = signTikTokWebhook(body, "secret", NOW);
    expect(verifyTikTokSignature(header, body, [], NOW)).toBe(false);
  });
});

describe("tiktokWebhookSecrets", () => {
  const saved = {
    a: process.env.TIKTOK_CLIENT_SECRET,
    b: process.env.TIKTOK_SANDBOX_CLIENT_SECRET,
  };
  afterEach(() => {
    process.env.TIKTOK_CLIENT_SECRET = saved.a;
    process.env.TIKTOK_SANDBOX_CLIENT_SECRET = saved.b;
    if (saved.a === undefined) delete process.env.TIKTOK_CLIENT_SECRET;
    if (saved.b === undefined) delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
  });

  it("returns both apps' secrets, deduplicated, ignoring unset ones", () => {
    process.env.TIKTOK_CLIENT_SECRET = "p";
    process.env.TIKTOK_SANDBOX_CLIENT_SECRET = "p";
    expect(tiktokWebhookSecrets()).toEqual(["p"]);
    delete process.env.TIKTOK_SANDBOX_CLIENT_SECRET;
    expect(tiktokWebhookSecrets()).toEqual(["p"]);
    process.env.TIKTOK_SANDBOX_CLIENT_SECRET = "s";
    expect(tiktokWebhookSecrets()).toEqual(["p", "s"]);
  });
});

describe("parseTikTokWebhookBody", () => {
  it("reads the event and the creator's open_id", () => {
    expect(parseTikTokWebhookBody(body)).toEqual({
      event: "authorization.removed",
      userOpenId: "open-id-fake-1",
      createTime: 1_700_000_000,
    });
  });

  it("returns null for something that is not an event", () => {
    expect(parseTikTokWebhookBody("not json")).toBeNull();
    expect(parseTikTokWebhookBody(JSON.stringify({ hello: 1 }))).toBeNull();
  });
});
