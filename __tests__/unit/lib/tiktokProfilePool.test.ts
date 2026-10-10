/**
 * @jest-environment node
 */
import {
  classifyProfilePage,
  openExitLanePool,
  openTikTokProfileFetcher,
  profileLaneCountFor,
} from "@/lib/platforms/tiktokProfilePool";
import type { ExitPage, TikTokExit } from "@/lib/platforms/tiktokExit";

const FAST = { minGapMs: 18, jitterMs: 0 };

function profileHtml(followers: number): string {
  const blob = {
    __DEFAULT_SCOPE__: {
      "webapp.user-detail": {
        userInfo: { user: { uniqueId: "x" }, stats: { followerCount: followers, videoCount: 3 }, statsV2: { followerCount: String(followers), videoCount: "3" } },
      },
    },
  };
  return `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(blob)}</script></html>`;
}
const SHELL = "<html><body>login</body></html>";

type Behaviour = (url: string, call: number) => ExitPage | null;

function fakeExit(id: string, behave: Behaviour, log?: { id: string; at: number }[]): TikTokExit & { calls: number; closed: boolean } {
  const e = {
    id,
    kind: "sandbox" as const,
    calls: 0,
    closed: false,
    async fetchPage(url: string) {
      e.calls += 1;
      log?.push({ id, at: Date.now() });
      return behave(url, e.calls);
    },
    async close() {
      e.closed = true;
    },
  };
  return e;
}

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("classifyProfilePage", () => {
  it("is an answer for a profile and for TikTok's no-such-account", () => {
    expect(classifyProfilePage({ status: 200, body: profileHtml(10), ms: 1 })).toBe("answer");
    const gone = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode: 10221 } },
    })}</script>`;
    expect(classifyProfilePage({ status: 200, body: gone, ms: 1 })).toBe("answer");
  });
  it("is a wall for the login shell and blocked for 403/429/5xx", () => {
    expect(classifyProfilePage({ status: 200, body: SHELL, ms: 1 })).toBe("wall");
    expect(classifyProfilePage({ status: 429, body: "", ms: 1 })).toBe("blocked");
    expect(classifyProfilePage({ status: 503, body: "", ms: 1 })).toBe("blocked");
  });
});

describe("profileLaneCountFor", () => {
  it("sizes lanes to the due reads at 1.8s each, capped", () => {
    expect(profileLaneCountFor(0, 240, 5)).toBe(0);
    expect(profileLaneCountFor(50, 240, 5)).toBe(1);
    expect(profileLaneCountFor(400, 240, 5)).toBe(3);
    expect(profileLaneCountFor(5000, 240, 5)).toBe(5);
  });
  it("covers the plan's floor of 542 reads a run with 5 lanes", () => {
    const lanes = profileLaneCountFor(542, 240, 5);
    expect((542 * 1.8) / lanes).toBeLessThanOrEqual(240);
  });
});

describe("exit lane pool", () => {
  it("finishes 300 queued reads across 2 lanes and keeps each lane's pace", async () => {
    const log: { id: string; at: number }[] = [];
    const pool = openTikTokProfileFetcher({
      lanes: 2,
      makeExit: (slot, gen) => fakeExit(`lane${slot}#${gen}`, () => ({ status: 200, body: profileHtml(1000), ms: 5 }), log),
      gate: FAST,
    });
    const reads = await Promise.all(Array.from({ length: 300 }, (_, i) => pool.read(`creator${i}`)));
    expect(reads.every((r) => r.result.ok)).toBe(true);

    const byLane = new Map<string, number[]>();
    for (const e of log) byLane.set(e.id, [...(byLane.get(e.id) ?? []), e.at]);
    expect([...byLane.keys()].sort()).toEqual(["lane0#1", "lane1#1"]);
    /* The gate schedules slots, so one late timer makes the next gap look
       short; the pace is the schedule. So each read is held to its slot --
       never before the lane's first read plus that many gaps -- rather than to
       the gap since the read before it, which a loaded runner shortens (7ms
       against 18 on CI, 2026-10-10). */
    for (const times of byLane.values()) {
      expect(times.length).toBe(150);
      for (let i = 1; i < times.length; i++) expect(times[i] - times[0]).toBeGreaterThanOrEqual(i * FAST.minGapMs - 10);
    }
    const stats = pool.stats();
    expect(stats.reduce((n, s) => n + s.proper, 0)).toBe(300);
    await pool.close();
  });

  it("retries a walled read on a different address and reports which exit answered", async () => {
    const pool = openTikTokProfileFetcher({
      lanes: 2,
      makeExit: (slot, gen) =>
        fakeExit(`lane${slot}#${gen}`, () => (slot === 0 ? { status: 200, body: SHELL, ms: 3 } : { status: 200, body: profileHtml(42), ms: 3 })),
      gate: FAST,
    });
    const r = await pool.read("someone");
    expect(r.result).toMatchObject({ ok: true });
    expect(r.via).toBe("lane1#1");
    expect(pool.wallStreak).toBe(0);
    const s = pool.stats();
    expect(s.find((x) => x.exitId === "lane0#1")?.walls).toBe(1);
  });

  it("counts a read walled on every address toward the wall streak", async () => {
    const pool = openTikTokProfileFetcher({
      lanes: 2,
      makeExit: (slot, gen) => fakeExit(`lane${slot}#${gen}`, () => ({ status: 200, body: SHELL, ms: 3 })),
      gate: FAST,
      maxAttempts: 2,
    });
    for (let i = 0; i < 3; i++) {
      const r = await pool.read(`walled${i}`);
      expect(r.result.ok).toBe(false);
    }
    expect(pool.maxWallStreak).toBe(3);
  });

  it("retires an exit that produces no page twice before ever answering, without spending the read", async () => {
    const pool = openExitLanePool({
      lanes: 2,
      makeExit: (slot, gen) => fakeExit(`lane${slot}#${gen}`, () => (slot === 0 ? null : { status: 200, body: profileHtml(1), ms: 1 })),
      gate: FAST,
      maxReplacements: 0,
    });
    for (let i = 0; i < 4; i++) {
      const got = await pool.request(`https://www.tiktok.com/@c${i}`, classifyProfilePage);
      expect(got?.outcome).toBe("answer");
    }
    expect(pool.size).toBe(1);
  });

  it("replaces a lane whose breaker latched with a fresh exit, within its budget", async () => {
    const made: string[] = [];
    const pool = openExitLanePool({
      lanes: 1,
      makeExit: (slot, gen) => {
        made.push(`lane${slot}#${gen}`);
        return fakeExit(`lane${slot}#${gen}`, () => (gen === 1 ? { status: 429, body: "", ms: 1 } : { status: 200, body: profileHtml(5), ms: 1 }));
      },
      gate: { ...FAST, breakerThreshold: 1 },
      maxReplacements: 1,
    });
    const got = await pool.request("https://www.tiktok.com/@c", classifyProfilePage);
    expect(got?.outcome).toBe("answer");
    expect(made).toEqual(["lane0#1", "lane0#2"]);
  });
});
