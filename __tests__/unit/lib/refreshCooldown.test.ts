import {
  REFRESH_COOLDOWN_MS,
  cooldownStateFrom,
  tooSoonMessage,
  type RefreshRunRow,
} from "@/lib/refreshCooldown";

/**
 * The gate that replaced an in-memory counter.
 *
 * The limiter this supersedes lived in a Map inside one serverless process, so
 * every cold start handed out a fresh allowance and two clicks a minute apart
 * both ran a full campaign refresh against a platform that is already
 * rationing us. These tests pin the properties that made it a real limit: it is
 * computed from a stored timestamp, it counts from when a run STARTED, and it
 * cannot be reset by anything the caller controls.
 */

const base = (over: Partial<NonNullable<RefreshRunRow>> = {}) => ({
  id: "run-1",
  status: "done",
  startedAt: new Date("2026-09-02T12:00:00Z"),
  finishedAt: new Date("2026-09-02T12:02:00Z"),
  total: 88,
  completed: 88,
  measured: 22,
  noMetrics: 62,
  unfetchable: 4,
  failed: 0,
  remaining: 0,
  reasons: { "platform-challenged": 62, "post-deleted": 4 },
  ...over,
});

describe("cooldownStateFrom", () => {
  it("allows a campaign that has never been refreshed", () => {
    const s = cooldownStateFrom(null);
    expect(s.canRefresh).toBe(true);
    expect(s.retryAfterSeconds).toBe(0);
    expect(s.lastRefreshAt).toBeNull();
  });

  it("refuses inside the window and says how long is left", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const now = new Date(startedAt.getTime() + 60 * 1000);

    const s = cooldownStateFrom(base({ startedAt }), now);

    expect(s.canRefresh).toBe(false);
    expect(s.retryAfterSeconds).toBe(29 * 60);
    expect(s.nextRefreshAt).toBe(new Date(startedAt.getTime() + REFRESH_COOLDOWN_MS).toISOString());
  });

  it("allows again the moment the window closes", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const now = new Date(startedAt.getTime() + REFRESH_COOLDOWN_MS);

    expect(cooldownStateFrom(base({ startedAt }), now).canRefresh).toBe(true);
  });

  /* Counting from finishedAt would charge a campaign for how long its own
     refresh took -- and an 88-post run takes minutes. */
  it("counts from when the run started, not when it ended", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const s = cooldownStateFrom(
      base({ startedAt, finishedAt: new Date("2026-09-02T12:20:00Z") }),
      new Date("2026-09-02T12:29:30Z"),
    );

    /* 29m30s after the start is inside the window; 9m30s after the finish would
       not have been, had we measured from the wrong end. */
    expect(s.canRefresh).toBe(false);
    expect(s.retryAfterSeconds).toBe(30);
  });

  it("reports a live run so the button can show its progress", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const s = cooldownStateFrom(
      base({ startedAt, status: "running", finishedAt: null, completed: 12 }),
      new Date(startedAt.getTime() + 30 * 1000),
    );

    expect(s.running).toEqual({ runId: "run-1", total: 88, completed: 12 });
  });

  /* A killed function never writes its final status. Trusting the column alone
     would leave the button spinning on a run that died with the process. */
  it("stops calling a long-dead run 'running'", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const s = cooldownStateFrom(
      base({ startedAt, status: "running", finishedAt: null }),
      new Date(startedAt.getTime() + 20 * 60 * 1000),
    );

    expect(s.running).toBeNull();
    /* Still inside the cooldown, though -- a run that died having already spent
       most of a campaign's platform budget must not license another one. */
    expect(s.canRefresh).toBe(false);
  });

  it("treats a failed run as having spent the window", () => {
    const startedAt = new Date("2026-09-02T12:00:00Z");
    const s = cooldownStateFrom(
      base({ startedAt, status: "failed" }),
      new Date(startedAt.getTime() + 5 * 60 * 1000),
    );

    expect(s.canRefresh).toBe(false);
  });
});

describe("tooSoonMessage", () => {
  it("matches the wording of the app this clones", () => {
    expect(tooSoonMessage(29 * 60)).toBe(
      "Please wait 29 mins before refreshing again for the latest updates.",
    );
  });

  it("rounds up, so it never tells someone to wait zero minutes", () => {
    expect(tooSoonMessage(20)).toBe(
      "Please wait 1 min before refreshing again for the latest updates.",
    );
  });

  it("says 'min' for one and 'mins' for more", () => {
    expect(tooSoonMessage(60)).toContain("1 min ");
    expect(tooSoonMessage(120)).toContain("2 mins ");
  });
});
