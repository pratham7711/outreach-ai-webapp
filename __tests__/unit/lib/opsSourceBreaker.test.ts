/**
 * @jest-environment node
 *
 * Per-source breakers: closed until N reads of a platform fail in a row, open
 * for a cooldown, then a few probes; any success closes it. Only failures of
 * the SOURCE count -- an answer about one account or one post is the source
 * working.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
jest.mock("@/lib/db", () => ({ db: {} }));

import {
  CLOSED_BREAKER,
  HALF_OPEN_PROBES,
  SOURCE_BREAKER_COOLDOWN_MS,
  SOURCE_BREAKER_THRESHOLD,
  breakerFromRow,
  classifyCreatorRead,
  classifyPostRead,
  createSourceGuard,
  effectivePhase,
  nextBreakerState,
  openSourceGuard,
  type BreakerState,
} from "@/lib/ops/sourceBreaker";

const T0 = 1_700_000_000_000;

function failTimes(n: number, s: BreakerState = CLOSED_BREAKER, at = T0): BreakerState {
  for (let i = 0; i < n; i++) s = nextBreakerState(s, "fail", at, "unreadable");
  return s;
}

describe("nextBreakerState", () => {
  it(`stays closed below ${SOURCE_BREAKER_THRESHOLD} consecutive failures`, () => {
    const s = failTimes(SOURCE_BREAKER_THRESHOLD - 1);
    expect(s.phase).toBe("closed");
    expect(s.consecutiveFailures).toBe(SOURCE_BREAKER_THRESHOLD - 1);
  });

  it(`opens at ${SOURCE_BREAKER_THRESHOLD}`, () => {
    const s = failTimes(SOURCE_BREAKER_THRESHOLD);
    expect(s.phase).toBe("open");
    expect(s.openedAt).toBe(T0);
    expect(effectivePhase(s, T0 + 1)).toBe("open");
  });

  it("is reset by one success in between, so only a run of failures opens it", () => {
    let s = failTimes(SOURCE_BREAKER_THRESHOLD - 1);
    s = nextBreakerState(s, "ok", T0);
    s = failTimes(SOURCE_BREAKER_THRESHOLD - 1, s);
    expect(s.phase).toBe("closed");
  });

  it("ignores neutral outcomes either way", () => {
    const s = failTimes(3);
    expect(nextBreakerState(s, "neutral", T0)).toBe(s);
  });

  it("turns half-open once the cooldown has run", () => {
    const s = failTimes(SOURCE_BREAKER_THRESHOLD);
    expect(effectivePhase(s, T0 + SOURCE_BREAKER_COOLDOWN_MS - 1)).toBe("open");
    expect(effectivePhase(s, T0 + SOURCE_BREAKER_COOLDOWN_MS)).toBe("half-open");
  });

  it("closes on a half-open success", () => {
    const open = failTimes(SOURCE_BREAKER_THRESHOLD);
    const s = nextBreakerState(open, "ok", T0 + SOURCE_BREAKER_COOLDOWN_MS);
    expect(s.phase).toBe("closed");
    expect(s.consecutiveFailures).toBe(0);
    expect(s.openedAt).toBeNull();
  });

  it("re-opens on a half-open failure, for a fresh cooldown", () => {
    const open = failTimes(SOURCE_BREAKER_THRESHOLD);
    const later = T0 + SOURCE_BREAKER_COOLDOWN_MS + 5;
    const s = nextBreakerState(open, "fail", later, "rate-limited");
    expect(s.phase).toBe("open");
    expect(s.openedAt).toBe(later);
    expect(effectivePhase(s, later + 1)).toBe("open");
  });
});

describe("classifiers", () => {
  it("counts a creator read by whether the SOURCE answered", () => {
    expect(classifyCreatorRead({ ok: true })).toBe("ok");
    expect(classifyCreatorRead({ ok: false, reason: "unreadable" })).toBe("fail");
    expect(classifyCreatorRead({ ok: false, reason: "rate-limited" })).toBe("fail");
    expect(classifyCreatorRead({ ok: false, reason: "no-credentials" })).toBe("neutral");
    expect(classifyCreatorRead({ ok: false, reason: "unsupported-platform" })).toBe("neutral");
    expect(classifyCreatorRead({ ok: false, reason: "not-found" })).toBe("ok");
  });

  it("counts a post read the same way", () => {
    expect(classifyPostRead({ status: "measured" })).toBe("ok");
    expect(classifyPostRead({ status: "unavailable", reason: "platform-challenged" })).toBe("fail");
    expect(classifyPostRead({ status: "unavailable", reason: "reader-unavailable" })).toBe("fail");
    expect(classifyPostRead({ status: "unavailable", reason: "post-deleted" })).toBe("ok");
    expect(classifyPostRead({ status: "unavailable", reason: "backing-off" })).toBe("neutral");
    expect(classifyPostRead({ status: "unavailable", reason: null })).toBe("neutral");
  });
});

describe("breakerFromRow", () => {
  it("is closed for an absent row", () => {
    expect(breakerFromRow(null)).toEqual(CLOSED_BREAKER);
  });

  it("reads a stored half-open as open, to be derived again from openedAt", () => {
    const s = breakerFromRow({
      key: "post-reads:tiktok",
      state: "half-open",
      consecutiveFailures: 30,
      openedAt: new Date(T0),
      lastFailureAt: null,
      lastSuccessAt: null,
      lastReason: null,
    });
    expect(s.phase).toBe("open");
    expect(s.openedAt).toBe(T0);
  });
});

describe("createSourceGuard", () => {
  const openState = failTimes(SOURCE_BREAKER_THRESHOLD);

  it("excludes killed sources at the query, and skips them if they slip through", () => {
    const g = createSourceGuard({ reader: "post-reads", breakers: false, killed: new Set(["instagram"]), states: {}, now: () => T0 });
    expect(g.excludedPlatforms).toEqual(["INSTAGRAM"]);
    expect(g.excludes("instagram")).toBe(true);
    expect(g.admit("INSTAGRAM")).toBe(false);
    expect(g.admit("TIKTOK")).toBe(true);
    expect(g.summary().instagram).toMatchObject({ killed: true, skipped: 1 });
  });

  it("ignores stored breakers when breakers are off for that reader", () => {
    const g = createSourceGuard({ reader: "creator-reads", breakers: false, killed: new Set(), states: { tiktok: openState }, now: () => T0 + 1 });
    expect(g.excludedPlatforms).toEqual([]);
    expect(g.admit("TIKTOK")).toBe(true);
  });

  it("excludes an open source, and lets a half-open one probe a few times", () => {
    let now = T0 + 1;
    const g = createSourceGuard({ reader: "post-reads", breakers: true, killed: new Set(), states: { tiktok: openState }, now: () => now });
    expect(g.excludedPlatforms).toEqual(["TIKTOK"]);
    expect(g.admit("TIKTOK")).toBe(false);

    now = T0 + SOURCE_BREAKER_COOLDOWN_MS;
    const admitted = Array.from({ length: HALF_OPEN_PROBES + 2 }, () => g.admit("TIKTOK"));
    expect(admitted.filter(Boolean)).toHaveLength(HALF_OPEN_PROBES);
  });

  it("does not exclude a half-open source at the query", () => {
    const g = createSourceGuard({
      reader: "post-reads",
      breakers: true,
      killed: new Set(),
      states: { tiktok: openState },
      now: () => T0 + SOURCE_BREAKER_COOLDOWN_MS,
    });
    expect(g.excludedPlatforms).toEqual([]);
  });

  it("opens in-run after the threshold and persists only what changed", async () => {
    const persist = jest.fn(async () => undefined);
    const g = createSourceGuard({ reader: "creator-reads", breakers: true, killed: new Set(), states: {}, now: () => T0, persist });
    for (let i = 0; i < SOURCE_BREAKER_THRESHOLD; i++) g.record("YOUTUBE", "fail", "unreadable");
    g.record("TIKTOK", "neutral");
    g.record("TWITCH", "fail");
    expect(g.admit("YOUTUBE")).toBe(false);
    expect(g.admit("TIKTOK")).toBe(true);
    await g.flush();
    expect(persist).toHaveBeenCalledTimes(1);
    const [[rows]] = persist.mock.calls as unknown as [[{ key: string; state: BreakerState }[]]];
    expect(rows.map((r) => r.key)).toEqual(["creator-reads:youtube"]);
    expect(rows[0].state.phase).toBe("open");
  });

  it("swallows a failed persist", async () => {
    const g = createSourceGuard({
      reader: "post-reads",
      breakers: true,
      killed: new Set(),
      states: {},
      now: () => T0,
      persist: async () => {
        throw new Error("down");
      },
    });
    g.record("TIKTOK", "fail");
    await expect(g.flush()).resolves.toBeUndefined();
  });
});

describe("openSourceGuard", () => {
  it("is all-closed and nothing killed when there is no database", async () => {
    const realUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const g = await openSourceGuard({ reader: "post-reads", breakers: true });
      expect(g.excludedPlatforms).toEqual([]);
      expect(g.admit("TIKTOK")).toBe(true);
    } finally {
      process.env.DATABASE_URL = realUrl;
    }
  });
});
