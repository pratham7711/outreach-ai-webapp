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

import {
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
