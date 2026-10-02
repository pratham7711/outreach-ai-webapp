import { snapshotCreators, type CreatorSnapshotResult } from "@/lib/creators/snapshot";
import { httpWorkerExit, sandboxExit, type TikTokExit } from "@/lib/platforms/tiktokExit";
import {
  openTikTokProfileFetcher,
  profileLaneCountFor,
  type ExitStats,
  type TikTokProfileFetcher,
} from "@/lib/platforms/tiktokProfilePool";
import { withTimeout } from "@/lib/platforms/tiktokBrowser";
import { createLogger } from "@/lib/observability/logger";
import { openSourceGuard } from "@/lib/ops/sourceBreaker";
import {
  inReaderV2Scope,
  medianOf,
  planBWorkerConfig,
  recordSourceHealth,
  type ResolvedTrackerPlan,
  type SourceHealthRow,
} from "./sourceSwitch";

/**
 * One run of reader v2 (plan §07): the due queue, lanes sized to it, the
 * sweep, and a health row at the end.
 *
 * The sweep itself is snapshotCreators -- the same reads, rungs, writes and
 * rotation as the legacy cron -- with TikTok profiles sent to lanes instead of
 * the direct fetch, the validation gate on, and the roster link fed from the
 * same read. Kept out of the route so a local script can run exactly this
 * against a test database.
 */

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/* Regions measured 2026-10-02 to serve full TikTok profiles to a Sandbox.
   bom1 and hkg1 do not; sin1 is where this project's own functions live, and
   is left out so a lane never shares a range with the egress that is walled.
   cdg1 served a 12-page probe in full but walled 59 of 111 pages in a
   sustained 4-minute soak the same day, while the four US lanes beside it
   answered 467 of 467 -- so the primaries are North American, and the rest
   are spares a replaced lane moves to. */
const DEFAULT_REGIONS = ["iad1", "sfo1", "cle1", "pdx1", "yul1", "gru1", "hnd1", "syd1"];

/** Which region a lane boots in. The first `lanes` regions are the
 *  primaries, one per slot; a replacement (a lane that latched on walls)
 *  moves to the spares in turn, so it does not boot straight back into the
 *  range that just walled it. With no spares it steps to the next primary. */
export function laneRegion(regions: string[], lanes: number, slot: number, generation: number): string {
  const primaries = regions.slice(0, Math.max(1, lanes));
  const spares = regions.slice(primaries.length);
  if (generation <= 1) return primaries[slot % primaries.length];
  if (spares.length > 0) return spares[(slot + generation - 2) % spares.length];
  return primaries[(slot + generation - 1) % primaries.length];
}

export const READER_V2_DEADLINE_MS = 4 * 60 * 1000;
export const READER_V2_GRACE_MS = 30_000;

export type ReaderRunOptions = {
  plan: ResolvedTrackerPlan;
  deadlineMs?: number;
  maxLanes?: number;
  maxCreators?: number;
  concurrency?: number;
  dryRun?: boolean;
  /** Local scripts: scope to one org of a test database. */
  orgId?: string;
  /** Local scripts: Sandbox credentials, where there is no OIDC token. */
  sandboxCredentials?: { token: string; teamId: string; projectId: string };
  /** Tests: replaces the exits entirely. */
  makeExit?: (slot: number, generation: number) => TikTokExit;
};

export type ReaderRunResult = {
  plan: "A" | "B";
  counts: CreatorSnapshotResult;
  dueTikTok: number;
  lanes: number;
  maxWallStreak: number;
  exits: ExitStats[];
  health: SourceHealthRow;
};

export function summariseExits(exits: ExitStats[]) {
  const pages = exits.reduce((n, e) => n + e.pages, 0);
  const failures = exits.reduce((n, e) => n + e.failures, 0);
  const proper = exits.reduce((n, e) => n + e.proper, 0);
  const walls = exits.reduce((n, e) => n + e.walls, 0);
  const reads = pages + failures;
  return {
    reads,
    proper,
    walls,
    failures,
    medianMs: medianOf(exits.flatMap((e) => e.latenciesMs)),
    /* A run with nothing to read is healthy; otherwise the bar is the plan's:
       97% of attempts answered properly. */
    ok: reads === 0 || proper / reads >= 0.97,
  };
}

export async function runReaderV2(options: ReaderRunOptions): Promise<ReaderRunResult> {
  const { plan } = options;
  const position = plan.effective;
  if (position !== "A" && position !== "B") throw new Error(`reader v2 cannot run as ${position}`);
  const log = createLogger({ context: { job: "reader-v2", plan: position } });

  const deadlineMs = options.deadlineMs ?? READER_V2_DEADLINE_MS;
  const maxLanes = options.maxLanes ?? envInt("TRACKER_V2_MAX_LANES", 5);
  const regions = (process.env.TRACKER_V2_REGIONS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const laneRegions = regions.length ? regions : DEFAULT_REGIONS;

  let makeExit = options.makeExit;
  let fixedLanes: number | null = null;
  if (!makeExit && position === "A") {
    /* Lifetime above deadline + grace, plus a minute for boot and close, so no
       lane is killed mid-read (plan F8; the old 240s lifetime was shorter than
       the 270s the sweep may run). */
    const lifetimeMs = deadlineMs + READER_V2_GRACE_MS + 60_000;
    makeExit = (slot, generation) => {
      const region = laneRegion(laneRegions, maxLanes, slot, generation);
      return sandboxExit({
        region,
        lifetimeMs,
        vcpus: 1,
        label: `A:${region}:${slot}#${generation}`,
        credentials: options.sandboxCredentials,
      });
    };
  }
  if (!makeExit && position === "B") {
    const config = planBWorkerConfig();
    if (!config) throw new Error("Plan B is not configured here");
    /* One lane per worker address: each worker is one identity and paces
       itself, so two lanes on one worker would only queue behind each other. */
    const urls = config.baseUrl.split(",").map((u) => u.trim()).filter(Boolean);
    fixedLanes = urls.length;
    makeExit = (slot, generation) => {
      const baseUrl = urls[slot % urls.length];
      return httpWorkerExit({ baseUrl, token: config.token, label: `B:${new URL(baseUrl).host}#${generation}` });
    };
  }

  let fetcher: TikTokProfileFetcher | null = null;
  let lanes = 0;
  let dueTikTok = 0;
  let postsStale = 0;
  const startedAt = new Date();
  const noLanes = { result: { ok: false as const, reason: "unreadable" as const, detail: "lanes not open" }, via: null };
  /* Kill switches and per-source breakers (plan §13 C). A dry run is guarded
     too but never moves a breaker. */
  const sourceGuard = await openSourceGuard({ reader: "creator-reads", breakers: true });

  let counts: CreatorSnapshotResult;
  try {
    counts = await snapshotCreators({
      plan: position,
      dryRun: options.dryRun,
      orgId: options.orgId,
      deadlineMs,
      abandonGraceMs: READER_V2_GRACE_MS,
      maxCreators: options.maxCreators ?? envInt("TRACKER_V2_MAX_PER_RUN", 600),
      concurrency: options.concurrency ?? envInt("TRACKER_V2_WORKERS", 9),
      orgIdsIn: plan.scopeOrgIds.length ? plan.scopeOrgIds : undefined,
      inScope: plan.percent < 100 ? (c) => inReaderV2Scope(plan, c) : undefined,
      onSelected: ({ byPlatform, tiktokPostsStale }) => {
        dueTikTok = byPlatform.TIKTOK ?? 0;
        postsStale = tiktokPostsStale;
        if (dueTikTok + postsStale === 0 || options.dryRun) return;
        lanes = fixedLanes ?? profileLaneCountFor(dueTikTok + postsStale, deadlineMs / 1000, maxLanes);
        fetcher = openTikTokProfileFetcher({ lanes, makeExit: makeExit! });
        log.info("reader v2 lanes open", { dueTikTok, postsStale, lanes, maxLanes });
      },
      readTikTokProfileVia: (handle) => (fetcher ? fetcher.read(handle) : Promise.resolve(noLanes)),
      readTikTokEmbedHtml: (handle) => (fetcher ? fetcher.readEmbedHtml(handle) : Promise.resolve(null)),
      sourceGuard,
    });
  } finally {
    const open = fetcher as TikTokProfileFetcher | null;
    if (open) {
      await withTimeout(open.close(), 15_000, "reader v2 lane cleanup").catch((e) =>
        log.warn("reader v2 lanes did not close in time", { error: e instanceof Error ? e.message : String(e) })
      );
    }
    if (!options.dryRun) await sourceGuard.flush();
  }

  const done = fetcher as TikTokProfileFetcher | null;
  const exits = done ? done.stats() : [];
  const summary = summariseExits(exits);
  const health: SourceHealthRow = {
    plan: position,
    kind: "run",
    startedAt,
    finishedAt: new Date(),
    reads: summary.reads,
    proper: summary.proper,
    walls: summary.walls,
    failures: summary.failures,
    medianMs: summary.medianMs,
    ok: summary.ok,
    detail: {
      dueTikTok,
      postsStale,
      lanes,
      maxWallStreak: done?.maxWallStreak ?? 0,
      snapshots: counts.snapshots,
      failed: counts.failed,
      skipped: counts.skipped,
      exits: exits.map((e) => ({ id: e.exitId, pages: e.pages, proper: e.proper, walls: e.walls, failures: e.failures })),
      sources: sourceGuard.summary(),
    },
  };
  if (!options.dryRun) await recordSourceHealth(health);
  log.info("reader v2 run complete", { ...counts, dueTikTok, lanes, ...summary });

  return {
    plan: position,
    counts,
    dueTikTok,
    lanes,
    maxWallStreak: done?.maxWallStreak ?? 0,
    exits,
    health,
  };
}
