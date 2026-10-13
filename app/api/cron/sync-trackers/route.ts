import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";

/* A browser read costs about ten seconds a sound, measured. The default
   function ceiling would cut the run off after a couple of sounds. */
export const maxDuration = 300;
export const runtime = "nodejs";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { openSoundBrowserSession } from "@/lib/platforms/tiktokSoundBrowser";
import { isMeasuredRung, readTikTokAudioUsage, type UsageRung } from "@/lib/platforms/tiktokAudioUsage";
import { openSandboxProfileFetcher } from "@/lib/platforms/tiktokProfileSandbox";
import { readInstagramAudioUsage } from "@/lib/platforms/instagramAudioUsage";
import { gateSoundReading, recordSoundSnapshot, soundMetadataPatch } from "@/lib/sounds/snapshot";
import { holdSoundReading, type TrackerSnapshot } from "@/lib/trackers/metrics";
import {
  readingPrecision,
  roundedAddsNothing,
  soundReadingChange,
  usesPrecisionOf,
  type UsesPrecision,
} from "@/lib/sounds/precision";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import {
  DEFAULT_GRANULARITY,
  isDueForRead,
  parseGranularity,
} from "@/lib/trackers/granularity";
import { cronRoute } from "@/lib/ops/cronRoute";

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

async function cronHandler(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-trackers" } });

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!bearerMatches(authHeader, cronSecret)) {
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
       cron fires every six hours and reads only what is actually due; an org on the
       6-hourly setting therefore does work on one run in six, and changing the
       setting needs no new schedule. */
    const orgs = await db.organization.findMany({ select: { id: true, uiConfig: true } });
    const cadenceByOrg = new Map(orgs.map((o) => [o.id, parseGranularity(o.uiConfig)]));

    /* Which MAX_SOUNDS, decided by when each was last read rather than when it
       was added.

       This was `orderBy: createdAt asc, take: MAX_SOUNDS`, and createdAt never
       changes: sound number 201 was never read, on any run, for as long as the first
       200 existed. Ordering by the newest snapshot ascending (never-read
       first) makes the window rotate, so the tail comes in on a later run
       instead of waiting for someone to delete a sound above it.

       Two queries because Prisma cannot order by a relation's max(recordedAt).
       The first is one row per sound with its newest snapshot only -- light
       enough to run over the whole table -- and the second pulls the 30-point
       history for just the window that won. */
    /* Both platforms now, and the row's own `platform` decides which reader
       sees it -- the dispatch in the read loop below is what keeps them apart.
       This used to be `where: { platform: "TIKTOK" }`, and that filter was
       load-bearing rather than defensive: every reader here builds a TikTok
       sound URL out of `tiktokSoundId`, and because the same numeric id can
       exist on both platforms, an Instagram row falling through would not
       merely go unread -- it would be read against TIKTOK's usage curve and
       stored as if it were Instagram's. That hazard has not gone away; it has
       moved into the branch. Keep the branch exhaustive. */
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
          platform: true,
          tiktokSoundId: true,
          title: true,
          artist: true,
          coverImageUrl: true,
          snapshots: {
            orderBy: { recordedAt: "desc" },
            take: 30,
            select: { usesCount: true, recordedAt: true },
          },
        },
      })
    ).sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0));

    /* Two passes, not one.

       This used to read a sound, wait, then read the next -- and a browser read
       costs about ten seconds, measured, which is why the run carries a
       five-minute ceiling and still stopped short of ninety-three sounds. The
       cadence check needs no network, so it happens for every sound first; then
       everything actually due is read in one batched, concurrent call.

       The ladder itself is unchanged and still in this order: the music embed,
       then the browser, then the music page. Only the embed rungs are batched --
       the browser is one session and reads serially by construction, and the
       music page stays behind it. */
    type DueSound = (typeof sounds)[number] & { history: TrackerSnapshot[] };
    const due: DueSound[] = [];

    for (const sound of sounds) {
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

      due.push({ ...sound, history });
    }

    /* Rung one, batched: the music EMBED page, over plain egress and then from
       the sandbox. It is the only rung that has ever worked from here and it
       costs one request.

       The music page proper carries no count and /api/music/detail/ answers an
       empty body without headers TikTok's client script signs — that is why
       this cron ran for weeks and wrote nothing, and why a browser on a VPS
       outside India was the documented plan. But
       https://www.tiktok.com/embed/music/<id> server-renders an embedInfo with
       the count in it (measured from a Vercel Sandbox, iad1). Same rescue the
       creator profile embed gave Top Posts.

       allowMusicPage stays off: that rung belongs BEHIND the browser, below. */
    const dueTikTok = due.filter((sound) => sound.platform === "TIKTOK");
    const dueInstagram = due.filter((sound) => sound.platform === "INSTAGRAM");

    const embedReadings = dueTikTok.length
      ? await readTikTokAudioUsage(
          dueTikTok.map((sound) => sound.tiktokSoundId),
          { deadlineAt: deadline, sandbox: remoteEmbed, allowMusicPage: false },
        )
      : new Map();

    /* Instagram needs none of the machinery above -- no sandbox, no browser
       session, one plain GET per audio that answers on the first try. */
    const instagramReadings = dueInstagram.length
      ? await readInstagramAudioUsage(
          dueInstagram.map((sound) => sound.tiktokSoundId),
          { deadlineAt: deadline },
        )
      : new Map();

    for (const sound of due) {
      if (Date.now() > deadline) {
        decisions.push({ soundId: sound.id, action: "skip", reason: "deadline-passed" });
        skipped++;
        continue;
      }

      if (sound.platform === "INSTAGRAM") {
        const outcome = instagramReadings.get(sound.tiktokSoundId);
        if (!outcome || (!outcome.ok && outcome.reason === "deadline")) {
          decisions.push({ soundId: sound.id, action: "skip", reason: "deadline-passed" });
          skipped++;
          continue;
        }
        if (!outcome.ok) {
          /* An audio that publishes no count is working as Instagram allows and
             must not sit in the failure ratio forever; anything else is a real
             miss and is named as one. */
          const isSilent = outcome.reason === "no-count";
          decisions.push({
            soundId: sound.id,
            action: isSilent ? "skip" : "fail",
            reason: outcome.reason,
          });
          if (isSilent) skipped++;
          else failed++;
          continue;
        }

        try {
          /* The shared writer rather than another inline create. The delta
             arithmetic in this file is already documented as its third copy,
             and the one thing Instagram adds -- withholding a delta between two
             rounded levels -- belongs beside the other two, not in a fourth.
             recordSoundSnapshot also applies soundMetadataPatch, which is why
             this branch returns before the TikTok tail does it again. */
          if (
            !(await recordSoundSnapshot(sound, outcome.reading, {
              precision: outcome.reading.precision,
              writer: "sync-trackers:instagram",
            }))
          ) {
            decisions.push({ soundId: sound.id, action: "skip", reason: "rounded-agrees:instagram" });
            skipped++;
            continue;
          }
        } catch (e) {
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
          reason: `instagram-${outcome.reading.precision}`,
          usesCount: outcome.reading.usesCount,
        });
        snapshotted++;
        continue;
      }

      /* Same predicate as the `due` partitions above, so a row that was handed
         to no reader is not then read through the wrong one. The column carries
         the app-wide Platform enum, which is wider than the two platforms whose
         audio pages publish a use count; falling through to the TikTok ladder
         is the defect the old `platform: "TIKTOK"` filter prevented. */
      if (sound.platform !== "TIKTOK") {
        decisions.push({ soundId: sound.id, action: "skip", reason: "no-reader-for-platform" });
        skipped++;
        continue;
      }

      const embed = embedReadings.get(sound.tiktokSoundId);
      let stats = embed?.ok ? embed.stats : null;
      // Which rung answered, so a strange reading can be traced to its source.
      let rung: string = embed?.ok ? embed.rung : "none";
      let precision: UsesPrecision | undefined;

      /* The embed's count is TikTok's display rounding once a sound passes
         10K -- every reading of a 74K sound on production was a multiple of 100
         (lib/sounds/precision). The browser reads /api/music/detail, whose
         stats are the exact count, so a rounded-looking embed figure is the one
         case worth a browser read even though the embed answered. If the
         browser cannot answer, the embed's figure stands and is written as the
         rounded figure it is. */
      if (stats && usesPrecisionOf(stats.usesCount) === "rounded") {
        const exact = await tiktok.read(sound.tiktokSoundId).catch((e) => {
          log.warn("browser read failed", { soundId: sound.id, error: String(e).slice(0, 120) });
          return null;
        });
        if (exact && exact.usesCount > 0) {
          stats = exact;
          rung = "browser";
          precision = "exact";
        }
      }

      /* Both kept behind the embed rather than deleted: the browser is the only
         path that can read a sound the embed refuses, and the plain fetch costs
         nothing when neither answers. */
      if (!stats) {
        stats = await tiktok.read(sound.tiktokSoundId).catch((e) => {
          log.warn("browser read failed", { soundId: sound.id, error: String(e).slice(0, 120) });
          return null;
        });
        if (stats) {
          rung = "browser";
          precision = "exact";
        }
      }
      if (!stats) {
        stats = await fetchTikTokSoundStats(sound.tiktokSoundId);
        if (stats) rung = "music-page";
      }
      if (!stats) {
        decisions.push({ soundId: sound.id, action: "fail", reason: "no-data" });
        failed++;
        continue;
      }

      /* A zero is a measurement only from the embed, which says "this sound
         exists and nothing uses it" in so many words. The browser and the
         music page return 0 when they could not read the count, and this
         route used to write that as a first reading -- or over any reading
         older than the hold's window -- as "0 uses". The nightly job already
         drew this line (snapshotSounds, isMeasuredRung). */
      if (stats.usesCount <= 0 && !isMeasuredRung(rung as UsageRung)) {
        decisions.push({ soundId: sound.id, action: "skip", reason: `unmeasured-zero:${rung}` });
        skipped++;
        continue;
      }

      /* The shared validation gate (plan A3): a fall to 0 from a real count,
         and a shell's title. Before the hold, which only looks at a fall
         inside its own window. */
      const gate = gateSoundReading(sound, stats, `sync-trackers:${rung}`);
      if (gate.rejected) {
        decisions.push({
          soundId: sound.id,
          action: "skip",
          reason: `rejected:${gate.rejections.map((r) => r.rule).join("+")}`,
          usesCount: stats.usesCount,
        });
        skipped++;
        continue;
      }

      /* A fall far below the last reading waits for the next read rather than
         being charted as half the sound's uses vanishing (see holdSoundReading).
         The sound stays due, so the next run reads it again. */
      const newestStored = sound.snapshots[0];
      if (holdSoundReading(newestStored, stats.usesCount, now)) {
        log.warn("sound reading held", {
          soundId: sound.id,
          rung,
          usesCount: stats.usesCount,
          previous: newestStored?.usesCount,
        });
        decisions.push({ soundId: sound.id, action: "skip", reason: `held-drop:${rung}`, usesCount: stats.usesCount });
        skipped++;
        continue;
      }

      /* A rounded figure that agrees with the exact reading already stored
         says nothing new, and writing it would replace 73,912 with 74,000. */
      const readPrecision = readingPrecision(stats.usesCount, precision);
      if (roundedAddsNothing(newestStored?.usesCount, stats.usesCount, readPrecision)) {
        decisions.push({ soundId: sound.id, action: "skip", reason: `rounded-agrees:${rung}`, usesCount: stats.usesCount });
        skipped++;
        continue;
      }

      /* LATEST MINUS PREVIOUS, not a 24-hour window, and PERCENT growth, not
         uses/hour -- the one arithmetic every sound writer shares
         (soundReadingChange), so this route can no longer disagree with
         recordSoundSnapshot about either.

         Both columns once had two writers and two meanings: this route wrote
         changeOverWindow(..., "24h").added into videosAdded24h and
         velocityPerHour into velocityScore, while recordSoundSnapshot wrote the
         change since the reading before and a percentage. The one label both
         feed, "Videos Added (Since Last Sync)" on the campaign audio card, is
         only true of the first, and the card prints velocity with a "%". A
         count of new videos is floored at zero (TikTok's uses figure does
         fall, and the report duly showed "-1 videos added"); deltaUses24h
         keeps the sign. And no change at all is recorded between two figures
         unless both are exact: the difference between two roundings is the
         rounding. */
      const change = soundReadingChange(newestStored?.usesCount, stats.usesCount, readPrecision);

      try {
        await db.soundTrackerSnapshot.create({
          data: {
            soundId: sound.id,
            usesCount: stats.usesCount,
            videosAdded24h: change.videosAdded24h,
            deltaUses24h: change.deltaUses24h,
            // Unit: percent change since the previous reading. See above.
            velocityScore: change.velocityScore,
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

      /* Renew the artwork while a fresh reading is in hand. This sweep runs
         hourly and had no metadata write at all, so a cover signed by TikTok's
         CDN could expire between one nightly job and the next with nothing to
         replace it. soundMetadataPatch decides: a name the operator typed is
         never touched, and an unsigned cover is left alone. */
      const patch = soundMetadataPatch(sound, stats);
      if (Object.keys(patch).length > 0) {
        // A cover is not worth failing a snapshot that already landed.
        await db.tikTokSound.update({ where: { id: sound.id }, data: patch }).catch((e) => {
          log.warn("sound metadata write failed", {
            soundId: sound.id,
            error: e instanceof Error ? e.message : String(e),
          });
        });
      }

      decisions.push({
        soundId: sound.id,
        action: "snapshot",
        reason: `ingested:${rung}`,
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

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("sync-trackers", cronHandler);
