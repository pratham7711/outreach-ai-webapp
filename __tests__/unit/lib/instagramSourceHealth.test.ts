/**
 * @jest-environment node
 *
 * The mapping from what Graph says to what a person is told.
 *
 * Every branch here was a silent state in production: a 190 read as "no posts
 * had views", a 200 with no linked Page read as healthy. The point of the tests
 * is that each one now produces a distinct, actionable sentence.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

const alertOps = jest.fn();
jest.mock("@/lib/alerts", () => ({ alertOps: (...args: unknown[]) => alertOps(...args) }));
/* The throttle reads EmailLog; an empty history means "not alerted today". */
jest.mock("@/lib/db", () => ({ db: { emailLog: { findFirst: jest.fn(async () => null) } } }));

const probeInstagramEmbedSurface = jest.fn();
jest.mock("@/lib/platforms/instagramEmbed", () => ({
  probeInstagramEmbedSurface: (...args: unknown[]) => probeInstagramEmbedSurface(...args),
}));

import {
  alertIfInstagramSourceDown,
  checkInstagramBusinessSourceUncached,
  type InstagramSourceHealth,
} from "@/lib/integrations/health";

const ORIGINAL_TOKEN = process.env.INSTAGRAM_BUSINESS_TOKEN;

function graphReplies(status: number, body: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

/** Narrowing helper: the failure arm is the one every test below asserts on. */
function asFailure(h: InstagramSourceHealth) {
  if (h.ok) throw new Error("expected an unhealthy result");
  return h;
}

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  process.env.INSTAGRAM_BUSINESS_TOKEN = "test-token";
});

afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.INSTAGRAM_BUSINESS_TOKEN;
  else process.env.INSTAGRAM_BUSINESS_TOKEN = ORIGINAL_TOKEN;
  jest.resetAllMocks();
});

describe("checkInstagramBusinessSource", () => {
  it("reports healthy with the count of linked Instagram accounts", async () => {
    graphReplies(200, {
      data: [
        { id: "p1", instagram_business_account: { id: "ig1", username: "a" } },
        { id: "p2" },
        { id: "p3", instagram_business_account: { id: "ig3", username: "c" } },
      ],
    });
    const health = await checkInstagramBusinessSourceUncached();
    expect(health).toMatchObject({ ok: true, igAccounts: 2 });
  });

  it("maps Graph code 190 to a sentence about the token, not a code", async () => {
    // The exact shape prod logs hourly: the password-change invalidation.
    graphReplies(400, {
      error: {
        code: 190,
        message:
          "Error validating access token: The session has been invalidated because the user changed their password.",
      },
    });
    const health = asFailure(await checkInstagramBusinessSourceUncached());
    expect(health.code).toBe(190);
    expect(health.reason).toBe("token expired or revoked");
  });

  it("maps the session variant, code 102, the same way", async () => {
    graphReplies(400, { error: { code: 102, message: "Session has expired" } });
    expect(asFailure(await checkInstagramBusinessSourceUncached()).reason).toBe(
      "token expired or revoked",
    );
  });

  it("says 'not configured' when the env var is absent, and asks Graph nothing", async () => {
    delete process.env.INSTAGRAM_BUSINESS_TOKEN;
    const health = asFailure(await checkInstagramBusinessSourceUncached());
    expect(health.reason).toBe("not configured");
    expect(health.code).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("treats a 200 with no linked Instagram account as down, not healthy", async () => {
    // Business Discovery is queried *from* an IG user id; with none, every
    // lookup returns null exactly as it does with a dead token.
    graphReplies(200, { data: [{ id: "p1" }] });
    const health = asFailure(await checkInstagramBusinessSourceUncached());
    expect(health.reason).toMatch(/no Instagram Business account/);
  });

  it("blames a missing permission on a 403 rather than the token", async () => {
    graphReplies(403, { error: { code: 10, message: "requires instagram_basic" } });
    expect(asFailure(await checkInstagramBusinessSourceUncached()).reason).toBe(
      "token is missing a required permission",
    );
  });

  it("separates our own network failure from a verdict on the token", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("ETIMEDOUT"));
    const health = asFailure(await checkInstagramBusinessSourceUncached());
    expect(health.code).toBeNull();
    expect(health.reason).toMatch(/could not reach Instagram/);
  });

  it("never puts the token in the result", async () => {
    graphReplies(400, { error: { code: 190, message: "bad token" } });
    const health = await checkInstagramBusinessSourceUncached();
    expect(JSON.stringify(health)).not.toContain("test-token");
  });

  it("sends the token to Graph as a query parameter and nowhere else", async () => {
    graphReplies(200, { data: [{ instagram_business_account: { id: "ig1" } }] });
    await checkInstagramBusinessSourceUncached();
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.pathname).toMatch(/\/me\/accounts$/);
    expect(url.searchParams.get("access_token")).toBe("test-token");
    expect(url.searchParams.get("fields")).toContain("instagram_business_account");
  });
});

/**
 * What the outage email claims, as opposed to what was true when it was written.
 *
 * `stillUpdating` was the string "likes and comments (public embed fallback)",
 * hardcoded. It was accurate in 2026-09 and wrong by 2026-09-17, when the embed
 * stopped serving post payloads -- and nothing in the system could tell, because
 * no code path ever asked the fallback anything. Measured against production the
 * same day: 150 Instagram posts with fresh snapshots over 7 days, zero moved
 * like counts. So the field is a measurement now, and these pin it.
 */
describe("alertIfInstagramSourceDown", () => {
  const down = () =>
    graphReplies(400, { error: { code: 190, message: "Session has been invalidated" } });

  it("reports the fallback as dead when the probe says it is", async () => {
    down();
    probeInstagramEmbedSurface.mockResolvedValue({
      state: "closed",
      serving: false,
      reason: "Instagram no longer publishes post figures on its public embed",
      status: 200,
      bytes: 1000,
    });

    const out = await alertIfInstagramSourceDown({
      rejectedPosts: 3,
      totalPosts: 10,
      samplePostUrl: "https://www.instagram.com/p/DcQFHR5pdYw/",
    });

    expect(out.alerted).toBe(true);
    const facts = alertOps.mock.calls[0][0].facts;
    expect(facts.stillUpdating).not.toMatch(/likes and comments \(public embed/i);
    expect(facts.stillUpdating).toMatch(/nothing/i);
    expect(facts.notUpdating).toBe("views, likes and comments");
    expect(facts.publicFallback).toMatch(/not serving/i);
  });

  it("goes back to the old sentence if the fallback answers again", async () => {
    down();
    probeInstagramEmbedSurface.mockResolvedValue({
      state: "serving",
      serving: true,
      reason: "the public Instagram embed is serving post data",
      status: 200,
      bytes: 262_000,
    });

    await alertIfInstagramSourceDown({
      rejectedPosts: 3,
      totalPosts: 10,
      samplePostUrl: "https://www.instagram.com/p/DcQFHR5pdYw/",
    });

    const facts = alertOps.mock.calls[0][0].facts;
    expect(facts.stillUpdating).toMatch(/likes and comments/i);
    expect(facts.notUpdating).toMatch(/views \(Business Discovery only\)/);
  });

  it("says it did not check rather than guessing, with no post to check with", async () => {
    down();
    await alertIfInstagramSourceDown({ rejectedPosts: 3, totalPosts: 10 });
    const facts = alertOps.mock.calls[0][0].facts;
    expect(probeInstagramEmbedSurface).not.toHaveBeenCalled();
    expect(facts.publicFallback).toMatch(/not checked/i);
    expect(facts.stillUpdating).toMatch(/nothing/i);
  });

  it("sends nothing at all while the platform token works", async () => {
    graphReplies(200, { data: [{ id: "p1", instagram_business_account: { id: "ig1" } }] });
    const out = await alertIfInstagramSourceDown({
      rejectedPosts: 3,
      totalPosts: 10,
      samplePostUrl: "https://www.instagram.com/p/DcQFHR5pdYw/",
    });
    expect(out).toEqual({ alerted: false, reason: "source-healthy" });
    expect(alertOps).not.toHaveBeenCalled();
    /* A rejected creator token is not an operator's problem, and probing the
       fallback for it would be an outbound request per cron run. */
    expect(probeInstagramEmbedSurface).not.toHaveBeenCalled();
  });
});
