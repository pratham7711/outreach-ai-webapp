import { createLogger } from "@/lib/observability/logger";
import { killedSources } from "./killSwitch";
import { opsDb, opsTablesReady } from "./opsTables";
import { OPS_SOURCES, platformOfSource, sourceOfPlatform, type OpsSource } from "./sources";

/**
 * Per-source breakers (plan §13 C), one level above the lanes.
 *
 * The lane pools already have a breaker per address (tiktokPostSandbox,
 * tiktokProfilePool): a walled lane is retired and replaced. That answers "is
 * this ADDRESS burned". This answers "is the SOURCE down" -- every read of a
 * platform failing in a row, whichever address asked -- so a reader stops
 * spending sandbox time and Meta quota on a platform that is not answering,
 * and comes back on its own once it does.
 *
 *   closed     -- reads go ahead. N consecutive failed reads open it.
 *   open       -- reads of that platform are skipped, and left due: a skipped
 *                 creator or post is not stamped as attempted, so it is first
 *                 in line once the source is back.
 *   half-open  -- after the cooldown, the next run lets a few probe reads
 *                 through. Any success closes it; a failure opens it again
 *                 for another cooldown.
 *
 * Conservative by construction: absent tables, a failed read of them, a
 * platform with no reader -- all closed. Only a read that is the SOURCE
 * failing counts (a WAF page, a refusal, our lane dying); a real answer about
 * an account or a post ("no such account", "deleted") counts as the source
 * working, and a missing credential counts as neither.
 *
 * Wired into reader v2 and the post sync only. The legacy creator sweep
 * consults the kill switches but not the breakers: its TikTok reads fail
 * through a WAF shell by design and recover through the sandbox rung, so its
 * failure stream is not a source signal, and it is the path that has to stay
 * untouched until reader v2 has run a week (plan §14 rule 2).
 */

export const SOURCE_BREAKER_THRESHOLD = 25;
export const SOURCE_BREAKER_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const HALF_OPEN_PROBES = 3;

export type BreakerReader = "creator-reads" | "post-reads";
export type BreakerPhase = "closed" | "open" | "half-open";
export type ReadOutcome = "ok" | "fail" | "neutral";

/** What is stored. "half-open" is never stored: it is an open breaker whose
 *  cooldown has run out, so it is derived from openedAt at the moment asked. */
export type BreakerState = {
  phase: "closed" | "open";
  consecutiveFailures: number;
  openedAt: number | null;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastReason: string | null;
};

export const CLOSED_BREAKER: BreakerState = {
  phase: "closed",
  consecutiveFailures: 0,
  openedAt: null,
  lastFailureAt: null,
  lastSuccessAt: null,
  lastReason: null,
};

export function breakerKey(reader: BreakerReader, source: OpsSource): string {
  return `${reader}:${source}`;
}

export function effectivePhase(s: BreakerState, nowMs: number, cooldownMs = SOURCE_BREAKER_COOLDOWN_MS): BreakerPhase {
  if (s.phase === "closed") return "closed";
  if (s.openedAt === null || nowMs - s.openedAt >= cooldownMs) return "half-open";
  return "open";
}

/** Pure: the breaker after one read. */
export function nextBreakerState(
  s: BreakerState,
  outcome: ReadOutcome,
  nowMs: number,
  reason: string | null = null,
  opts: { threshold?: number; cooldownMs?: number } = {}
): BreakerState {
  if (outcome === "neutral") return s;
  if (outcome === "ok") {
    return { ...s, phase: "closed", consecutiveFailures: 0, openedAt: null, lastSuccessAt: nowMs };
  }
  const threshold = opts.threshold ?? SOURCE_BREAKER_THRESHOLD;
  const failed = { ...s, consecutiveFailures: s.consecutiveFailures + 1, lastFailureAt: nowMs, lastReason: reason };
  const phase = effectivePhase(s, nowMs, opts.cooldownMs);
  if (phase === "half-open") return { ...failed, phase: "open", openedAt: nowMs };
  if (phase === "open") return failed;
  if (failed.consecutiveFailures >= threshold) return { ...failed, phase: "open", openedAt: nowMs };
  return failed;
}

const CREATOR_SOURCE_FAILURES = new Set(["unreadable", "rate-limited"]);
const CREATOR_NEITHER = new Set(["no-credentials", "unsupported-platform"]);

/** A creator profile read, as the breaker counts it. */
export function classifyCreatorRead(result: { ok: true } | { ok: false; reason: string; detail?: string }): ReadOutcome {
  if (result.ok) return "ok";
  /* A sweep that held back below Meta's limit asked nothing, so the source
     said nothing either way (lib/platforms/instagramDiscoveryTokens). */
  if (result.reason === "rate-limited" && result.detail?.startsWith("deferred:")) return "neutral";
  if (CREATOR_SOURCE_FAILURES.has(result.reason)) return "fail";
  if (CREATOR_NEITHER.has(result.reason)) return "neutral";
  return "ok";
}

/* The fetch reasons that are the source not answering us, as opposed to an
   answer about the post (deleted), about one creator's credential, or a gate
   of our own that never asked (backing-off). */
const POST_SOURCE_FAILURES = new Set(["platform-challenged", "platform-refused", "reader-unavailable", "reader-timeout"]);
/* Instagram's two answers about an account are answers too: Business Discovery
   said there is no such account (#110), or read the account and the post was
   not on it. Neutral until 2026-10-03, so they never closed a breaker; with the
   cron's Instagram queue headed by 94 such posts (measured that day), the only
   reads that could ever close it were the ones it was skipping. */
const POST_ANSWERS = new Set([
  "post-deleted", "unrecognised-url", "not-a-professional-account", "not-on-account", "not-in-newest-media",
  "not-public",
]);

/** A post metrics read, as the breaker counts it. */
export function classifyPostRead(outcome: { status: string; reason?: string | null }): ReadOutcome {
  if (outcome.status === "measured") return "ok";
  const reason = outcome.reason ?? "";
  if (POST_SOURCE_FAILURES.has(reason)) return "fail";
  if (POST_ANSWERS.has(reason)) return "ok";
  return "neutral";
}

type Row = {
  key: string;
  state: string;
  consecutiveFailures: number;
  openedAt: Date | null;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  lastReason: string | null;
};

export function breakerFromRow(row: Row | null | undefined): BreakerState {
  if (!row) return CLOSED_BREAKER;
  return {
    phase: row.state === "open" || row.state === "half-open" ? "open" : "closed",
    consecutiveFailures: Math.max(0, row.consecutiveFailures ?? 0),
    openedAt: row.openedAt ? row.openedAt.getTime() : null,
    lastFailureAt: row.lastFailureAt ? row.lastFailureAt.getTime() : null,
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.getTime() : null,
    lastReason: row.lastReason,
  };
}

export type SourceGuardSummary = Record<
  OpsSource,
  { killed: boolean; phase: BreakerPhase; consecutiveFailures: number; skipped: number }
>;

/**
 * One run's view of the kill switches and breakers. Read once when the run
 * starts; breakers are updated in memory as reads land and written back by
 * flush() at the end.
 */
export type SourceGuard = {
  /** Platforms to leave out at the query: switched off, or breaker open. */
  readonly excludedPlatforms: ("TIKTOK" | "INSTAGRAM" | "YOUTUBE")[];
  excludes: (platform: string) => boolean;
  /** May this run read this platform now? False also counts a skip. */
  admit: (platform: string) => boolean;
  record: (platform: string, outcome: ReadOutcome, reason?: string | null) => void;
  flush: () => Promise<void>;
  summary: () => SourceGuardSummary;
};

export function createSourceGuard(input: {
  reader: BreakerReader;
  breakers: boolean;
  killed: Set<OpsSource>;
  states: Partial<Record<OpsSource, BreakerState>>;
  now?: () => number;
  persist?: (rows: { key: string; state: BreakerState }[]) => Promise<void>;
}): SourceGuard {
  const now = input.now ?? Date.now;
  const states = new Map<OpsSource, BreakerState>(
    OPS_SOURCES.map((s) => [s, input.breakers ? input.states[s] ?? CLOSED_BREAKER : CLOSED_BREAKER])
  );
  const changed = new Set<OpsSource>();
  const probes = new Map<OpsSource, number>();
  const skipped = new Map<OpsSource, number>();
  const startedAt = now();

  const excludedPlatforms = OPS_SOURCES.filter(
    (s) => input.killed.has(s) || (input.breakers && effectivePhase(states.get(s)!, startedAt) === "open")
  ).map(platformOfSource);

  const skip = (s: OpsSource) => {
    skipped.set(s, (skipped.get(s) ?? 0) + 1);
    return false;
  };

  return {
    excludedPlatforms,
    excludes: (platform) => (excludedPlatforms as string[]).includes(String(platform).toUpperCase()),
    admit(platform) {
      const s = sourceOfPlatform(platform);
      if (!s) return true;
      if (input.killed.has(s)) return skip(s);
      if (!input.breakers) return true;
      const phase = effectivePhase(states.get(s)!, now());
      if (phase === "closed") return true;
      if (phase === "open") return skip(s);
      const used = probes.get(s) ?? 0;
      if (used >= HALF_OPEN_PROBES) return skip(s);
      probes.set(s, used + 1);
      return true;
    },
    record(platform, outcome, reason = null) {
      if (!input.breakers || outcome === "neutral") return;
      const s = sourceOfPlatform(platform);
      if (!s) return;
      const before = states.get(s)!;
      const after = nextBreakerState(before, outcome, now(), reason);
      if (after.phase === "open" && before.phase === "closed") {
        createLogger({ context: { lib: "ops/sourceBreaker" } }).warn("source breaker opened", {
          key: breakerKey(input.reader, s),
          consecutiveFailures: after.consecutiveFailures,
          reason,
        });
      }
      states.set(s, after);
      changed.add(s);
    },
    async flush() {
      if (!input.breakers || changed.size === 0 || !input.persist) return;
      const rows = [...changed].map((s) => ({ key: breakerKey(input.reader, s), state: states.get(s)! }));
      changed.clear();
      await input.persist(rows).catch(() => {});
    },
    summary() {
      const at = now();
      return Object.fromEntries(
        OPS_SOURCES.map((s) => [
          s,
          {
            killed: input.killed.has(s),
            phase: effectivePhase(states.get(s)!, at),
            consecutiveFailures: states.get(s)!.consecutiveFailures,
            skipped: skipped.get(s) ?? 0,
          },
        ])
      ) as SourceGuardSummary;
    },
  };
}

async function persistBreakers(rows: { key: string; state: BreakerState }[]): Promise<void> {
  if (!(await opsTablesReady())) return;
  const db = await opsDb();
  const date = (ms: number | null) => (ms === null ? null : new Date(ms));
  for (const { key, state } of rows) {
    const data = {
      state: state.phase,
      consecutiveFailures: state.consecutiveFailures,
      openedAt: date(state.openedAt),
      lastFailureAt: date(state.lastFailureAt),
      lastSuccessAt: date(state.lastSuccessAt),
      lastReason: state.lastReason ? state.lastReason.slice(0, 200) : null,
      updatedAt: new Date(),
    };
    await db.opsSourceBreaker
      .upsert({ where: { key }, create: { key, ...data }, update: data, select: { key: true } })
      .catch((e: unknown) =>
        createLogger({ context: { lib: "ops/sourceBreaker" } }).warn("source breaker not saved", {
          key,
          error: e instanceof Error ? e.message : String(e),
        })
      );
  }
}

export async function readBreakers(reader: BreakerReader): Promise<Partial<Record<OpsSource, BreakerState>>> {
  if (!(await opsTablesReady())) return {};
  try {
    const db = await opsDb();
    const rows = await db.opsSourceBreaker.findMany({
      where: { key: { in: OPS_SOURCES.map((s) => breakerKey(reader, s)) } },
    });
    const out: Partial<Record<OpsSource, BreakerState>> = {};
    for (const s of OPS_SOURCES) out[s] = breakerFromRow(rows.find((r) => r.key === breakerKey(reader, s)));
    return out;
  } catch {
    return {};
  }
}

/** A run's guard, read from the database. Never throws: anything wrong is
 *  "nothing killed, every breaker closed", which is how the readers ran before
 *  any of this existed. */
export async function openSourceGuard(options: { reader: BreakerReader; breakers: boolean }): Promise<SourceGuard> {
  const killed = await killedSources().catch(() => new Set<OpsSource>());
  const states = options.breakers ? await readBreakers(options.reader).catch(() => ({})) : {};
  return createSourceGuard({ reader: options.reader, breakers: options.breakers, killed, states, persist: persistBreakers });
}

/** Closes a breaker by hand, from the ops page. */
export async function resetBreaker(key: string): Promise<{ ok: boolean; error?: string }> {
  const [reader, source] = key.split(":");
  if ((reader !== "creator-reads" && reader !== "post-reads") || !OPS_SOURCES.includes(source as OpsSource)) {
    return { ok: false, error: "unknown breaker" };
  }
  if (!(await opsTablesReady())) return { ok: false, error: "ops tables are not applied" };
  await persistBreakers([{ key, state: { ...CLOSED_BREAKER, lastSuccessAt: Date.now(), lastReason: "reset by operator" } }]);
  return { ok: true };
}
