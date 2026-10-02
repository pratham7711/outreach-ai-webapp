import { createLogger } from "@/lib/observability/logger";
import { createRateGate, type RateGate } from "./fetchPostMetrics";
import { parseTikTokProfileHtml } from "./tiktokProfile";
import { tikTokEmbedUrl } from "./tiktokTopPostsEmbed";
import type { CreatorReadResult } from "./creatorProfile";
import type { ExitPage, TikTokExit } from "./tiktokExit";

/**
 * Reader v2's lanes: creator profile reads spread across several exits, each
 * paced on its own.
 *
 * The same shape as the post pool (tiktokPostSandbox.ts) -- a gate per lane,
 * round-robin pick, a burned lane replaced by a fresh address, a walled read
 * retried on a different one -- with two differences that are the point of
 * this module. Lanes are TikTokExits, so Plan A (Sandbox) and Plan B (our own
 * worker) share every line below. And it is used ONLY by the creator-tracker
 * reader when the switch says A or B: openSandboxProfileFetcher and its six
 * callers (sounds, music, roster, avatars, the legacy sweep) are untouched
 * (plan F7), so nothing else moves when this one does.
 *
 * The post pool is deliberately not refactored onto this yet. It carries
 * LKM's "Refresh data" button, and the plan moves other callers over one at a
 * time once this has run a week clean.
 */

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** One address asking about once every 1.8s is the profile measured to work:
 *  Azure US and Google SG served 100% full pages at this pace for 3 hours
 *  (2026-10-01), and Sandbox lanes the same in the post pool. */
export const PROFILE_LANE_SECONDS = 1.8;

export type ExitStats = {
  exitId: string;
  kind: TikTokExit["kind"];
  /** Requests that reached the wire and came back with a page. */
  pages: number;
  /** Pages that were TikTok actually answering: a profile, or "no such account". */
  proper: number;
  /** Login shells and 403/429/5xx: the address was refused. */
  walls: number;
  /** The exit itself failed -- no boot, no worker, timeout. Not TikTok's answer. */
  failures: number;
  latenciesMs: number[];
};

export type PoolOutcome = "answer" | "wall" | "blocked";

type Lane = {
  slot: number;
  generation: number;
  exit: TikTokExit;
  gate: RateGate;
  /** Consecutive exit failures with no page in between. Two in a row on a
   *  lane that has never produced a page means it cannot boot. */
  failuresInRow: number;
  everAnswered: boolean;
  dead: boolean;
};

export type ExitLanePoolOptions = {
  lanes: number;
  makeExit: (slot: number, generation: number) => TikTokExit;
  /** Distinct addresses one URL is worth before its wall is accepted. */
  maxAttempts?: number;
  maxReplacements?: number;
  gate?: Partial<Parameters<typeof createRateGate>[0]>;
};

export type ExitLanePool = {
  /** The page from the first lane whose answer `classify` accepts, or the last
   *  walled page, or null if no lane produced a page at all. */
  request: (
    url: string,
    classify: (page: ExitPage) => PoolOutcome
  ) => Promise<{ page: ExitPage; exitId: string; outcome: PoolOutcome } | null>;
  stats: () => ExitStats[];
  readonly size: number;
  close: () => Promise<void>;
};

export function openExitLanePool(options: ExitLanePoolOptions): ExitLanePool {
  const log = createLogger({ context: { platform: "TIKTOK", via: "exit-lane-pool" } });
  const laneCount = Math.max(0, options.lanes);
  const maxAttempts = Math.max(1, options.maxAttempts ?? envInt("TIKTOK_PROFILE_LANE_MAX_ATTEMPTS", 3));
  const maxReplacements = options.maxReplacements ?? envInt("TIKTOK_PROFILE_LANE_MAX_REPLACEMENTS", laneCount * 2);

  /* Its own env prefix. The post pool's TIKTOK_SANDBOX_* knobs size LKM's
     "Refresh data" lanes, and retuning those for the tracker would move that
     button too (plan F8). */
  const newGate = () =>
    createRateGate({
      minGapMs: envInt("TIKTOK_PROFILE_LANE_MIN_GAP_MS", 1500),
      jitterMs: envInt("TIKTOK_PROFILE_LANE_JITTER_MS", 600),
      breakerThreshold: envInt("TIKTOK_PROFILE_LANE_BREAKER_THRESHOLD", 5),
      breakerCooldownMs: envInt("TIKTOK_PROFILE_LANE_BREAKER_COOLDOWN_MS", 10 * 60 * 1000),
      challengeThreshold: envInt("TIKTOK_PROFILE_LANE_CHALLENGE_THRESHOLD", 6),
      challengeCooldownMs: envInt("TIKTOK_PROFILE_LANE_CHALLENGE_COOLDOWN_MS", 5 * 60 * 1000),
      ...options.gate,
    });

  const stats = new Map<string, ExitStats>();
  const statFor = (exit: TikTokExit): ExitStats => {
    let s = stats.get(exit.id);
    if (!s) {
      s = { exitId: exit.id, kind: exit.kind, pages: 0, proper: 0, walls: 0, failures: 0, latenciesMs: [] };
      stats.set(exit.id, s);
    }
    return s;
  };

  const lanes: Lane[] = Array.from({ length: laneCount }, (_, slot) => ({
    slot,
    generation: 1,
    exit: options.makeExit(slot, 1),
    gate: newGate(),
    failuresInRow: 0,
    everAnswered: false,
    dead: false,
  }));

  let replacements = 0;
  /* A cooldown is a statement about one address, and a replacement is a new
     one with a clean gate -- obtained in seconds instead of minutes. Bounded,
     because "boot until it works" against a wall is how a run becomes a bill. */
  const replace = (lane: Lane): boolean => {
    if (replacements >= maxReplacements) return false;
    replacements += 1;
    const spent = lane.exit;
    spent.close().catch(() => {});
    lane.generation += 1;
    lane.exit = options.makeExit(lane.slot, lane.generation);
    lane.gate = newGate();
    lane.failuresInRow = 0;
    lane.everAnswered = false;
    lane.dead = false;
    log.warn("lane replaced with a fresh exit", {
      lane: lane.exit.id,
      replaced: spent.id,
      replacementsUsed: replacements,
      budget: maxReplacements,
    });
    return true;
  };

  let cursor = 0;
  const pick = (tried: Set<string>): Lane | null => {
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (lane.dead || lane.gate.isOpen() || tried.has(lane.exit.id)) continue;
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }
    /* Every lane is latched, dead or already spent on this URL. A latched lane
       will not reopen inside a run, so buy an address rather than give up. */
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (!lane.dead && !lane.gate.isOpen() && !tried.has(lane.exit.id)) continue;
      if (!replace(lane)) break;
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }
    return null;
  };

  const attempt = async (
    lane: Lane,
    url: string,
    classify: (page: ExitPage) => PoolOutcome
  ): Promise<{ page: ExitPage; outcome: PoolOutcome } | null> => {
    if (!(await lane.gate.acquire())) return null;
    const exit = lane.exit;
    const s = statFor(exit);
    const page = await exit.fetchPage(url);
    if (!page) {
      s.failures += 1;
      lane.failuresInRow += 1;
      lane.gate.recordBlocked();
      if (!lane.everAnswered && lane.failuresInRow >= 2) {
        lane.dead = true;
        log.error("exit produced no page twice; retiring the lane for this run", { lane: exit.id });
      }
      return null;
    }
    lane.failuresInRow = 0;
    lane.everAnswered = true;
    s.pages += 1;
    s.latenciesMs.push(page.ms);
    const outcome = classify(page);
    if (outcome === "answer") {
      s.proper += 1;
      lane.gate.recordSuccess();
    } else {
      s.walls += 1;
      if (outcome === "blocked") lane.gate.recordBlocked();
      else lane.gate.recordChallenged();
      if (lane.gate.isOpen()) replace(lane);
    }
    return { page, outcome };
  };

  return {
    get size() {
      return lanes.filter((l) => !l.dead).length;
    },
    async request(url, classify) {
      const tried = new Set<string>();
      let last: { page: ExitPage; exitId: string; outcome: PoolOutcome } | null = null;
      let asked = 0;
      while (asked < maxAttempts) {
        const lane = pick(tried);
        if (!lane) break;
        tried.add(lane.exit.id);
        const exitId = lane.exit.id;
        const got = await attempt(lane, url, classify);
        if (!got) {
          /* An exit that produced nothing never asked TikTok, so it does not
             spend the URL's attempts -- unless it is now dead, in which case
             the next pick skips it anyway. */
          if (lane.dead) continue;
          asked += 1;
          continue;
        }
        asked += 1;
        last = { ...got, exitId };
        if (got.outcome === "answer") return last;
      }
      return last;
    },
    stats() {
      return [...stats.values()].map((s) => ({ ...s, latenciesMs: [...s.latenciesMs] }));
    },
    async close() {
      await Promise.all(lanes.map((l) => l.exit.close().catch(() => {})));
    },
  };
}

/** How a profile page reads to the pool. "No such account" is TikTok
 *  answering, so it is final; a page without the rehydration blob is the shell
 *  a refused address gets. */
export function classifyProfilePage(page: ExitPage): PoolOutcome {
  if (page.status === 403 || page.status === 429 || page.status >= 500) return "blocked";
  if (page.status !== 200) return "answer";
  const parsed = parseTikTokProfileHtml(page.body);
  if (parsed.ok || parsed.reason === "no-such-account") return "answer";
  return parsed.detail === "no rehydration blob in page" ? "wall" : "answer";
}

/** The embed page answers or it does not; a short body is the shell. */
export function classifyEmbedPage(page: ExitPage): PoolOutcome {
  if (page.status === 403 || page.status === 429 || page.status >= 500) return "blocked";
  if (page.status === 200 && page.body.length < 2_000) return "wall";
  return "answer";
}

export type ProfileRead = { result: CreatorReadResult; via: string | null };

export type TikTokProfileFetcher = {
  read: (handle: string) => Promise<ProfileRead>;
  readEmbedHtml: (handle: string) => Promise<string | null>;
  stats: () => ExitStats[];
  /** Reads that ended walled on every address they were offered, in a row.
   *  Three is the alert (plan T8): a pool-wide wall, not one unlucky lane. */
  readonly wallStreak: number;
  /** The longest such streak this run. */
  readonly maxWallStreak: number;
  readonly size: number;
  close: () => Promise<void>;
};

export function openTikTokProfileFetcher(options: ExitLanePoolOptions): TikTokProfileFetcher {
  const pool = openExitLanePool(options);
  let wallStreak = 0;
  let maxWallStreak = 0;
  return {
    get size() {
      return pool.size;
    },
    get wallStreak() {
      return wallStreak;
    },
    get maxWallStreak() {
      return maxWallStreak;
    },
    stats: () => pool.stats(),
    async read(handle) {
      const clean = handle.replace(/^@/, "").trim();
      if (!clean) return { result: { ok: false, reason: "unreadable", detail: "empty handle" }, via: null };
      const got = await pool.request(`https://www.tiktok.com/@${encodeURIComponent(clean)}`, classifyProfilePage);
      if (!got) {
        return { result: { ok: false, reason: "unreadable", detail: "lanes: no exit produced a page" }, via: null };
      }
      if (got.outcome !== "answer") {
        wallStreak += 1;
        maxWallStreak = Math.max(maxWallStreak, wallStreak);
        return {
          result: { ok: false, reason: "unreadable", detail: `lanes: walled on every address tried (${got.exitId})` },
          via: got.exitId,
        };
      }
      wallStreak = 0;
      if (got.page.status !== 200) {
        return {
          result: { ok: false, reason: "unreadable", detail: `lanes: HTTP ${got.page.status}` },
          via: got.exitId,
        };
      }
      return { result: parseTikTokProfileHtml(got.page.body), via: got.exitId };
    },
    async readEmbedHtml(handle) {
      const clean = handle.replace(/^@/, "").trim();
      if (!clean) return null;
      const got = await pool.request(tikTokEmbedUrl(clean), classifyEmbedPage);
      return got?.outcome === "answer" && got.page.status === 200 ? got.page.body : null;
    },
    close: () => pool.close(),
  };
}

/** Lanes for a run: enough that the due reads finish inside the run at one
 *  read per PROFILE_LANE_SECONDS per lane, never more than the cap. */
export function profileLaneCountFor(dueReads: number, runSeconds: number, maxLanes: number): number {
  if (dueReads <= 0) return 0;
  const needed = Math.ceil((dueReads * PROFILE_LANE_SECONDS) / Math.max(1, runSeconds));
  return Math.max(1, Math.min(maxLanes, needed));
}
