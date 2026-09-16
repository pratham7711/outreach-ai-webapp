/**
 * The credential that keeps Instagram view counts moving.
 *
 * Its failure mode is the reason this suite is specific about outcomes rather
 * than about calls: when the token dies, nothing errors -- fetchPostMetrics
 * falls through to the public embed, which carries likes and comments but no
 * views -- so a refresher that reports success while extending nothing would be
 * indistinguishable from one that works, for about six weeks. Every assertion
 * below is aimed at that: that "not due" is not silence, that an unextended
 * exchange is a failure and not a success, and that an expiry is never absent.
 */
import { randomBytes } from "crypto";

// TOKEN_ENCRYPTION_KEY is a real secret, absent from CI and a fresh checkout.
// Same throwaway key the crypto and tiktokToken suites mint.
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockExchange = jest.fn();
jest.mock("@/lib/platforms/instagram", () => ({
  exchangeForLongLivedToken: (...args: unknown[]) => mockExchange(...args),
}));

import {
  ASSUMED_LIFETIME_DAYS,
  INSTAGRAM_BUSINESS_PROVIDER,
  REFRESH_WHEN_DAYS_LEFT,
  clearInstagramBusinessTokenCache,
  getInstagramBusinessToken,
  instagramCredentialStatus,
  refreshInstagramBusinessToken,
  storeInstagramBusinessToken,
} from "@/lib/platforms/instagramBusinessToken";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/encrypt";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-17T00:00:00.000Z");

/** A stored row, expiring `daysLeft` days after NOW. */
function row(daysLeft: number, overrides: Record<string, unknown> = {}) {
  return {
    accessToken: encrypt("stored-token", INSTAGRAM_BUSINESS_PROVIDER),
    expiresAt: new Date(NOW.getTime() + daysLeft * DAY),
    refreshedAt: new Date(NOW.getTime() - 10 * DAY),
    lastAttemptAt: null,
    lastError: null,
    source: "manual",
    ...overrides,
  };
}

/** What upsert was asked to write, decrypted. */
function written() {
  const data = mockUpsert.mock.calls.at(-1)?.[0]?.update;
  return {
    ...data,
    plaintext: decrypt(data.accessToken, INSTAGRAM_BUSINESS_PROVIDER),
  };
}

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue(null);
  mockUpsert.mockReset().mockResolvedValue({});
  mockUpdate.mockReset().mockResolvedValue({});
  mockExchange.mockReset();
  delete process.env.INSTAGRAM_BUSINESS_TOKEN;
  clearInstagramBusinessTokenCache();
});

describe("getInstagramBusinessToken", () => {
  it("prefers the stored credential over the environment", async () => {
    process.env.INSTAGRAM_BUSINESS_TOKEN = "env-token";
    mockFindUnique.mockResolvedValue(row(40));
    expect(await getInstagramBusinessToken()).toBe("stored-token");
  });

  it("falls back to the environment when there is no row", async () => {
    process.env.INSTAGRAM_BUSINESS_TOKEN = "env-token";
    expect(await getInstagramBusinessToken()).toBe("env-token");
  });

  it("falls back to the environment when the row cannot be read", async () => {
    /* A database hiccup must not take Instagram views down while a working env
       var is sitting right there. */
    process.env.INSTAGRAM_BUSINESS_TOKEN = "env-token";
    mockFindUnique.mockRejectedValue(new Error("connection terminated"));
    expect(await getInstagramBusinessToken()).toBe("env-token");
  });

  it("still returns an expired stored token", async () => {
    // Graph answers a dead token with a 190, which the health probe reports as
    // "expired or revoked". Withholding it here would say "not configured"
    // instead and send someone to set up a connection that already exists.
    mockFindUnique.mockResolvedValue(row(-5));
    expect(await getInstagramBusinessToken()).toBe("stored-token");
  });

  it("does not query again inside the cache window", async () => {
    mockFindUnique.mockResolvedValue(row(40));
    await getInstagramBusinessToken();
    await getInstagramBusinessToken();
    expect(mockFindUnique).toHaveBeenCalledTimes(1);
  });

  it("re-reads once a write has cleared the cache", async () => {
    mockFindUnique.mockResolvedValue(row(40));
    await getInstagramBusinessToken();
    clearInstagramBusinessTokenCache();
    await getInstagramBusinessToken();
    expect(mockFindUnique).toHaveBeenCalledTimes(2);
  });
});

describe("storeInstagramBusinessToken", () => {
  it("exchanges the pasted value before storing it", async () => {
    /* What a person copies out of Graph Explorer is usually the one-hour
       token. Storing that verbatim would schedule the first renewal for six
       weeks after it had already died. */
    const expiresAt = new Date(NOW.getTime() + 60 * DAY);
    mockExchange.mockResolvedValue({ accessToken: "long-lived", expiresAt });

    const result = await storeInstagramBusinessToken("  short-lived  ");
    expect(result).toEqual({ ok: true, expiresAt, exchanged: true });
    expect(mockExchange).toHaveBeenCalledWith("short-lived");
    expect(written().plaintext).toBe("long-lived");
  });

  it("stores the value encrypted, never in the clear", async () => {
    mockExchange.mockResolvedValue({ accessToken: "long-lived", expiresAt: null });
    await storeInstagramBusinessToken("t");
    expect(isEncrypted(mockUpsert.mock.calls[0][0].update.accessToken)).toBe(true);
  });

  it("dates a silent response at the documented lifetime, never at forever", async () => {
    mockExchange.mockResolvedValue({ accessToken: "long-lived", expiresAt: null });
    const result = await storeInstagramBusinessToken("t");
    if (!result.ok) throw new Error("expected a successful store");
    const days = (result.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeCloseTo(ASSUMED_LIFETIME_DAYS, 1);
  });

  it("keeps a token Meta would not exchange, and says it did not exchange", async () => {
    /* The exchange needs INSTAGRAM_CLIENT_ID/SECRET. An instance holding the
       token but not the app credentials would otherwise be unable to store
       anything at all. */
    mockExchange.mockRejectedValue(new Error("no client secret"));
    const result = await storeInstagramBusinessToken("hand-made");
    expect(result).toMatchObject({ ok: true, exchanged: false });
    expect(written().plaintext).toBe("hand-made");
  });

  it("refuses an empty token without touching the database", async () => {
    expect(await storeInstagramBusinessToken("   ")).toEqual({
      ok: false,
      reason: "no token supplied",
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("refreshInstagramBusinessToken", () => {
  it("does nothing while the credential is nowhere near expiry", async () => {
    mockFindUnique.mockResolvedValue(row(40));
    const outcome = await refreshInstagramBusinessToken({ now: NOW });
    expect(outcome).toEqual({
      status: "not-due",
      expiresAt: new Date(NOW.getTime() + 40 * DAY).toISOString(),
      daysLeft: 40,
    });
    // The point of the daily schedule: on most days it costs one query and no
    // Graph call at all.
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("exchanges anyway when forced", async () => {
    // So an operator can find out today whether renewal works, rather than in
    // six weeks when it matters.
    mockFindUnique.mockResolvedValue(row(40));
    mockExchange.mockResolvedValue({
      accessToken: "fresh",
      expiresAt: new Date(NOW.getTime() + 60 * DAY),
    });
    const outcome = await refreshInstagramBusinessToken({ now: NOW, force: true });
    expect(outcome.status).toBe("refreshed");
  });

  it("renews inside the window and reports what it bought", async () => {
    mockFindUnique.mockResolvedValue(row(10));
    mockExchange.mockResolvedValue({
      accessToken: "fresh",
      expiresAt: new Date(NOW.getTime() + 60 * DAY),
    });
    const outcome = await refreshInstagramBusinessToken({ now: NOW });
    expect(outcome).toEqual({
      status: "refreshed",
      expiresAt: new Date(NOW.getTime() + 60 * DAY).toISOString(),
      daysLeft: 60,
      addedDays: 50,
    });
    expect(written().plaintext).toBe("fresh");
    expect(written().source).toBe("refresh");
  });

  it("treats an exchange that extends nothing as a failure, not a success", async () => {
    /* The one that matters. Meta does not promise that trading a long-lived
       token returns a later expiry, and a refresher that assumes it does would
       log success every day for a fortnight and then go dark. */
    mockFindUnique.mockResolvedValue(row(10));
    mockExchange.mockResolvedValue({
      accessToken: "same-window",
      expiresAt: new Date(NOW.getTime() + 10 * DAY),
    });
    const outcome = await refreshInstagramBusinessToken({ now: NOW });
    expect(outcome.status).toBe("not-extended");
    // Kept regardless: it is a working token, and discarding it would throw
    // away the only valid credential there is.
    expect(written().plaintext).toBe("same-window");
    expect(mockUpdate.mock.calls[0][0].data.lastError).toMatch(/cannot be renewed automatically/);
  });

  it("records why Meta refused, and keeps the credential it has", async () => {
    mockFindUnique.mockResolvedValue(row(3));
    mockExchange.mockRejectedValue(new Error("OAuthException"));
    const outcome = await refreshInstagramBusinessToken({ now: NOW });
    expect(outcome).toMatchObject({ status: "failed", daysLeft: 3 });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("reports a credential that does not exist anywhere", async () => {
    expect(await refreshInstagramBusinessToken({ now: NOW })).toEqual({ status: "no-credential" });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("adopts the environment variable on the first run", async () => {
    /* What makes this a no-op to deploy: the existing env var moves itself into
       a place that can renew it, with no operator step. */
    process.env.INSTAGRAM_BUSINESS_TOKEN = "env-token";
    mockExchange.mockResolvedValue({
      accessToken: "fresh",
      expiresAt: new Date(NOW.getTime() + 60 * DAY),
    });
    const outcome = await refreshInstagramBusinessToken({ now: NOW });

    // Adopted at the refresh window rather than a full lifetime -- its real
    // expiry is unknowable from here, and the short reading is the safe one --
    // which puts it immediately in range, so the same run exchanges it.
    const adopted = mockUpsert.mock.calls[0][0].update;
    expect(decrypt(adopted.accessToken, INSTAGRAM_BUSINESS_PROVIDER)).toBe("env-token");
    expect(adopted.expiresAt.getTime()).toBe(NOW.getTime() + REFRESH_WHEN_DAYS_LEFT * DAY);
    expect(outcome.status).toBe("refreshed");
  });

  it("reports a read failure instead of throwing at the cron", async () => {
    mockFindUnique.mockRejectedValue(new Error("connection terminated"));
    const outcome = await refreshInstagramBusinessToken({ now: NOW });
    expect(outcome).toMatchObject({ status: "failed", expiresAt: null, daysLeft: null });
  });
});

describe("instagramCredentialStatus", () => {
  it("names the environment as the source when nothing is stored", async () => {
    process.env.INSTAGRAM_BUSINESS_TOKEN = "env-token";
    expect(await instagramCredentialStatus()).toMatchObject({ source: "env", daysLeft: null });
  });

  it("reports none when there is no credential at all", async () => {
    expect(await instagramCredentialStatus()).toMatchObject({ source: "none" });
  });

  it("counts the days left, negative once it has passed", async () => {
    mockFindUnique.mockResolvedValue(row(-2, { lastError: "Meta refused the exchange" }));
    const status = await instagramCredentialStatus();
    expect(status.source).toBe("stored");
    expect(status.daysLeft).toBeLessThan(0);
    expect(status.lastError).toBe("Meta refused the exchange");
  });

  it("never returns the token itself", async () => {
    mockFindUnique.mockResolvedValue(row(30));
    const status = await instagramCredentialStatus();
    expect(JSON.stringify(status)).not.toContain("stored-token");
  });
});
