import { NextRequest, NextResponse } from "next/server";

/* A browser read costs about ten seconds a sound, measured. The default
   function ceiling would cut the run off after a couple of sounds. */
export const maxDuration = 300;
export const runtime = "nodejs";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { openSoundBrowserSession } from "@/lib/platforms/tiktokSoundBrowser";
import { readTikTokSoundViaEmbed } from "@/lib/platforms/tiktokSoundEmbed";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import {
  changeOverWindow,
  previousOf,
  velocityBetween,
  type TrackerSnapshot,
} from "@/lib/trackers/metrics";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import {
  DEFAULT_GRANULARITY,
  isDueForRead,
  parseGranularity,
} from "@/lib/trackers/granularity";

export const dynamic = "force-dynamic";

const MIN_INTERVAL_HOURS = 1;
const HOUR_MS = 1000 * 60 * 60;
const MAX_SOUNDS = 200;

type Decision = {
  soundId: string;
  action: "snapshot" | "skip" | "fail";
  reason: string;
  usesCount?: number;
};

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-trackers" } });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const deadline = Date.now() + 4 * 60 * 1000;

  const decisions: Decision[] = [];
  let snapshotted = 0;
  let skipped = 0;
  let failed = 0;

  /* One browser for the whole sweep -- launched lazily on the first sound that
     actually needs a read, so a run where everything is skipped stays cheap.
     Per-sound launches paid the launch cost ~93 times and raced on the binary
     extracted to /tmp (ETXTBSY), which is how the creator sweep first failed. */
  const tiktok = openSoundBrowserSession();
  /* One sandbox for the sweep, booted lazily on the first embed read that needs
     it — same arrangement as the browser session above and for the same reason. */
  const remoteEmbed = openSandboxProfileFetcher();

  try {
    /* Cadence is per-organisation, so the run needs each sound's owner. The
       cron fires hourly and reads only what is actually due; an org on the
       6-hourly setting therefore does work on one run in six, and changing the
       setting needs no new schedule. */
    const orgs = await db.organization.findMany({ select: { id: true, uiConfig: true } });
    const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseGranularity(o.uiConfig)]));

    /* Which MAX_SOUNDS, decided by when each was last read rather than when it
       was added.

       This was `orderBy: createdAt asc, take: MAX_SOUNDS`, and createdAt never
       changes: sound #201 was never read, on any run, for as long as the first
       200 existed. Ordering by the newest snapshot ascending (never-read
       first) makes the window rotate, so the tail comes in on a later run
       instead of waiting for someone to delete a sound above it.

       Two queries because Prisma cannot order by a relation's max(recordedAt).
       The first is one row per sound with its newest snapshot only -- light
       enough to run over the whole table -- and the second pulls the 30-point
       history for just the window that won. */
    const candidates = await db.tikTokSound.findMany({
      select: {
        id: true,
        snapshots: { orderBy: { recordedAt: "desc" }, take: 1, select: { recordedAt: true } },
      },
    });
    const dueOrder = candidates
      .map((c) => ({ id: c.id, lastReadAt: c.snapshots[0]?.recordedAt ?? null }))
      .sort((a, b) => {
        // Never read sorts first; it is the staleest thing there is.
        if (!a.lastReadAt) return b.lastReadAt ? -1 : 0;
        if (!b.lastReadAt) return 1;
        return a.lastReadAt.getTime() - b.lastReadAt.getTime();
      })
      .slice(0, MAX_SOUNDS);
    const orderIndex = new Map(dueOrder.map((d, i) => [d.id, i]));

    const sounds = (
      await db.tikTokSound.findMany({
        where: { id: { in: dueOrder.map((d) => d.id) } },
        select: {
          id: true,
          orgId: true,
          tiktokSoundId: true,
          snapshots: {
            orderBy: { recordedAt: "desc" },
            take: 30,
            select: { usesCount: true, recordedAt: true },
          },
        },
      })
    ).sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    for (const sound of sounds) {
      if (Date.now() > deadline) {
        decisions.push({ soundId: sound.id, action: "skip", reason: "deadline-passed" });
        skipped++;
        continue;
      }

      const history: TrackerSnapshot[] = sound.snapshots.map((s) => ({
        value: s.usesCount,
        recordedAt: s.recordedAt,
      }));

      /* MIN_INTERVAL_HOURS used to be a flat 1, which meant the org's chosen
         cadence had no effect on anything: the setting existed, the screen
         offered it, and the reader ignored it. */
      const granularity = cadenceByOrg.get(sound.orgId) ?? DEFAULT_GRANULARITY;
      const newest = history.length > 0 ? history[0] : null;
      if (!isDueForRead(newest?.recordedAt ?? null, granularity, now)) {
        decisions.push({
          soundId: sound.id,
          action: "skip",
          reason: `not-due (${granularity.readCadence})`,
        });
        skipped++;
        continue;
      }

      if (dryRun) {
        decisions.push({ soundId: sound.id, action: "snapshot", reason: "dry-run" });
        continue;
      }

      /* The music EMBED page is tried first because it is the only rung that has
         ever worked from here, and it costs one request.

         The music page proper carries no count and /api/music/detail/ answers an
         empty body without headers TikTok's client script signs — that is why
         this cron ran for weeks and wrote nothing, and why a browser on a VPS
         outside India was the documented plan. But
         https://www.tiktok.com/embed/music/<id> server-renders an embedInfo with
         the count in it (measured from a Vercel Sandbox, iad1). Same rescue the
         creator profile embed gave Top Posts. */
      let stats = await readTikTokSoundViaEmbed(sound.tiktokSoundId, (id) =>
        remoteEmbed.readMusicEmbedHtml(id)
      ).catch((e) => {
        log.warn("embed read failed", { soundId: sound.id, error: String(e).slice(0, 120) });
        return null;
      });

      /* Both kept behind the embed rather than deleted: the browser is the only
         path that can read a sound the embed refuses, and the plain fetch costs
         nothing when neither answers. */
      if (!stats) {
        stats = await tiktok.read(sound.tiktokSoundId).catch((e) => {
          log.warn("browser read failed", { soundId: sound.id, error: String(e).slice(0, 120) });
          return null;
        });
      }
      if (!stats) stats = await fetchTikTokSoundStats(sound.tiktokSoundId);
      if (!stats) {
        decisions.push({ soundId: sound.id, action: "fail", reason: "no-data" });
        failed++;
        continue;
      }

      const latest: TrackerSnapshot = { value: stats.usesCount, recordedAt: now };
      const withLatest = [...history, latest];

      /* PERCENT growth against the previous reading, not uses/hour.

         velocityScore had two writers in two units: recordSoundSnapshot (and
         the creator sweep, and the seed) store velocityBetween, a percentage,
         while this route stored velocityPerHour. The column is one column, so
         a sound read by one writer and then the other produced a series that
         changes unit halfway along, and its one consumer -- the campaign audio
         card, via lib/reports/campaignPerformance -- renders every point with a
         "%" suffix. So percent is what the reader expects, and this was the
         writer that disagreed. The trackers page does not read the column at
         all; it recomputes velocityPerHour from the series (see
         app/api/trackers/route.ts), which is why the mismatch stayed invisible
         there. */
      const previous = previousOf(withLatest);
      const velocity = previous ? velocityBetween(previous.value, latest.value) : 0;
      const day = changeOverWindow(withLatest, "24h", now);

      try {
        await db.soundTrackerSnapshot.create({
          data: {
            soundId: sound.id,
            usesCount: stats.usesCount,
            /* A count of new videos cannot be negative, and TikTok's uses figure
               does fall — it fell by one here, and the report duly showed
               "-1 videos added". deltaUses24h is the signed change and keeps the
               sign; videosAdded24h is a count and is floored, exactly as
               recordSoundSnapshot does it. Third copy of this arithmetic; the
               second one put a percentage in the same column. */
            videosAdded24h: day ? Math.max(0, Math.round(day.added)) : 0,
            deltaUses24h: day ? Math.round(day.added) : 0,
            // Unit: percent change since the previous reading. See above.
            velocityScore: velocity,
            recordedAt: now,
          },
        });
      } catch (e) {
        /* One bad write is one sound. Unguarded, a constraint clash or a
           dropped connection threw out of the loop and abandoned every sound
           after it -- having already paid for their browser and sandbox
           time, which is the expensive half of this job. */
        log.error("snapshot write failed", {
          soundId: sound.id,
          error: e instanceof Error ? e.message : String(e),
        });
        decisions.push({ soundId: sound.id, action: "fail", reason: "write-failed" });
        failed++;
        continue;
      }

      decisions.push({
        soundId: sound.id,
        action: "snapshot",
        reason: "ingested",
        usesCount: stats.usesCount,
      });
      snapshotted++;
    }

    log.info("tracker sweep complete", { snapshotted, skipped, failed, dryRun });

    /* One digest per run, at the cron boundary, exactly as snapshot-sounds
       does it -- and for the same reason it lowered minFailures: an org tracks
       a handful of sounds, so the whole corpus failing sits well under the
       default of 5 and this reader has been able to fail completely, every
       hour, in silence. A dry run reads nothing and so can report nothing. */
    if (!dryRun && shouldAlertOnBatch({ failed, total: snapshotted + failed, minFailures: 1 })) {
      await alertOps({
        source: "cron/sync-trackers",
        title: `Sound tracker sweep failing: ${failed} of ${snapshotted + failed}`,
        severity: "critical",
        facts: { snapshotted, failed, skipped, considered: sounds.length },
      });
    }

    return NextResponse.json({
      dryRun,
      considered: sounds.length,
      snapshotted,
      skipped,
      failed,
      decisions,
    });
  } catch (error) {
    log.error("tracker sweep threw", {
      error: error instanceof Error ? error.message : String(error),
    });
    /* A crash used to leave nothing but a log line: this cron writes the only
       numbers the sound trackers ever show, so a run that dies on its first
       query looks identical, from the product, to a quiet hour. */
    await alertOps({
      source: "cron/sync-trackers",
      title: "Sound tracker sweep crashed",
      severity: "critical",
      facts: { error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ error: "Tracker sweep failed" }, { status: 500 });
  } finally {
    await tiktok.close();
    await remoteEmbed.close().catch(() => {});
  }
}
