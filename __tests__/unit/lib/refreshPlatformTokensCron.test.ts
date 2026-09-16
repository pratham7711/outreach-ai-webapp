/**
 * @jest-environment node
 *
 * What the nightly credential run tells a human.
 *
 * The refresh itself is covered in instagramBusinessToken.test.ts; what is
 * pinned here is the part that replaces the old silence. The incident this cron
 * exists to prevent was not a crash -- it was a token that died with nobody
 * told, while likes and comments kept updating and only the view column stood
 * still. So the policy matters as much as the mechanism: which outcomes page
 * someone, which merely log, and which are severe enough to interrupt a day.
 */
const mockRefresh = jest.fn();
jest.mock("@/lib/platforms/instagramBusinessToken", () => ({
  REFRESH_WHEN_DAYS_LEFT: 14,
  refreshInstagramBusinessToken: (...args: unknown[]) => mockRefresh(...args),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/alerts", () => ({ alertOps: (...args: unknown[]) => mockAlert(...args) }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/refresh-platform-tokens/route";

const SECRET = "cron-secret-for-tests";

function call(query = "", auth: string | null = `Bearer ${SECRET}`) {
  return GET(
    new NextRequest(`http://localhost/api/cron/refresh-platform-tokens${query}`, {
      headers: auth ? { authorization: auth } : {},
    }),
  );
}

beforeEach(() => {
  mockRefresh.mockReset().mockResolvedValue({ status: "not-due", expiresAt: "x", daysLeft: 40 });
  mockAlert.mockReset().mockResolvedValue(undefined);
  process.env.CRON_SECRET = SECRET;
});

describe("the credential cron's door", () => {
  it("refuses a caller with no secret", async () => {
    const res = await call("", null);
    expect(res.status).toBe(401);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("refuses the wrong secret", async () => {
    expect((await call("", "Bearer nope")).status).toBe(401);
  });

  it("refuses everyone when the deployment has no secret configured", async () => {
    // Otherwise an unset variable would leave the endpoint open to anyone.
    delete process.env.CRON_SECRET;
    expect((await call("", "Bearer undefined")).status).toBe(401);
  });

  it("passes force through only when asked", async () => {
    await call();
    expect(mockRefresh).toHaveBeenCalledWith({ force: false });
    await call("?force=1");
    expect(mockRefresh).toHaveBeenLastCalledWith({ force: true });
  });
});

describe("what earns an alert", () => {
  it("says nothing on an ordinary quiet day", async () => {
    await call();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("says nothing when a refresh simply worked", async () => {
    mockRefresh.mockResolvedValue({ status: "refreshed", expiresAt: "x", daysLeft: 60, addedDays: 46 });
    await call();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("does not page about a deployment that has no Instagram credential", async () => {
    /* A deliberate state, not a fault -- and the trackers page already says so
       to the people who would act on it. */
    mockRefresh.mockResolvedValue({ status: "no-credential" });
    await call();
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("treats an unrenewable credential as critical, whatever the runway", async () => {
    /* The quiet killer: Meta keeps handing back tokens, nothing errors, and the
       expiry never moves. Only a person reconnecting fixes it, so this is worth
       waking someone for while there is still time to do it. */
    mockRefresh.mockResolvedValue({ status: "not-extended", expiresAt: "x", daysLeft: 13 });
    await call();
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const sent = mockAlert.mock.calls[0][0];
    expect(sent.severity).toBe("critical");
    expect(sent.title).toMatch(/a person must reconnect/i);
  });

  it("warns, rather than pages, on a single failure with runway left", async () => {
    // Paging every day for a fortnight is how an alert stops being read.
    mockRefresh.mockResolvedValue({ status: "failed", reason: "Meta refused", expiresAt: "x", daysLeft: 12 });
    await call();
    expect(mockAlert.mock.calls[0][0].severity).toBe("warn");
  });

  it("escalates the same failure once the runway is nearly gone", async () => {
    mockRefresh.mockResolvedValue({ status: "failed", reason: "Meta refused", expiresAt: "x", daysLeft: 5 });
    await call();
    const sent = mockAlert.mock.calls[0][0];
    expect(sent.severity).toBe("critical");
    expect(sent.title).toMatch(/5 day/);
  });

  it("carries the reason, never the token", async () => {
    mockRefresh.mockResolvedValue({ status: "failed", reason: "Meta refused", expiresAt: "x", daysLeft: 2 });
    await call();
    expect(mockAlert.mock.calls[0][0].facts).toMatchObject({ reason: "Meta refused", daysLeft: 2 });
  });

  it("reports a thrown refresh instead of failing silently", async () => {
    mockRefresh.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(500);
    expect(mockAlert.mock.calls[0][0].severity).toBe("critical");
  });
});
