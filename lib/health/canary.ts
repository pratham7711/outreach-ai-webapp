import type { Platform } from "@/lib/generated/prisma/client";
import { READ_CADENCE_HOURS, parsePostTracking } from "@/lib/trackers/granularity";

/*
 * Every database and platform module is loaded at the moment it is needed
 * rather than at the top of the file. Not a style choice: @/lib/db constructs a
 * PrismaClient on import and throws on sight in jsdom, so a top-level import
 * would make the pure helpers below -- the only part with a decision in it, and
 * the part worth testing -- unimportable from a unit test. Every caller here is
 * already async, so the cost is a resolved module lookup.
 */
async function database() {
  const { db } = await import("@/lib/db");
  return db;
}

/**
 * A handful of rows whose only job is to fail visibly when a reader dies.
 *
 * Every platform outage this product has had was discovered the same way: a
 * person noticed a number had not moved. Instagram views stopped on 2026-09-06
 * and were still stopped ten days later, with nothing red anywhere, because the
 * only posts that would have shown it belong to campaigns nobody had open. The
 * fleet is not a monitor — 15,000 TikTok posts in COMPLETE campaigns are not
 * swept, a campaign can be deleted, a tracker expires — so "are the readers
 * working" can never be answered by asking the fleet.
 *
 * These rows answer it. One post per platform, one creator per platform, one
 * sound, all in a campaign reserved for the purpose, all tracked forever. If
 * they are writing snapshots, the reader behind them works. If one stops, that
 * reader is down, and it says so before a client does.
 */

/** The campaign the canary rows live in. Matched by title, so nothing in the
 *  schema has to change to mark a campaign as infrastructure — and the title is
 *  what an operator sees if they ever stumble into it. */
export const CANARY_CAMPAIGN_TITLE = "Platform health canary";

/**
 * The canary's tracking expiry: far enough out to mean "never".
 *
 * Post trackers are deliberately always bounded (1–30 days — see
 * lib/trackers/granularity), which is what makes the number of them unlimited.
 * A canary is the one row that must outlive every window, because a health
 * check that seals itself after a month is a health check that reports green
 * by being absent. It is a date rather than a null because null already means
 * "written before the column existed" to lib/sync/postTracking#effectiveExpiry,
 * and overloading it would make every legacy row unbounded too.
 */
export const CANARY_TRACKING_EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

/** How far behind cadence a canary may fall before it is stale: two reads.
 *  One missed read is a cron that ran a few minutes late or a platform that
 *  rate-limited once; two in a row is the reader. */
export const STALE_AFTER_READS = 2;

/** Marks the sound row as the canary's. TikTokSound has no free column to flag
 *  one with, and its title is replaced by the first real reading — so the
 *  prefix is kept in front of whatever TikTok comes back with. */
export const CANARY_SOUND_TITLE_PREFIX = "[canary]";

/** The platforms a canary post is expected for: the ones this codebase has a
 *  post reader for. LINKEDIN and TWITCH are excluded — there is no sweep behind
 *  them, so a canary would be permanently red about nothing. */
export const CANARY_POST_PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE"];

export type CanaryVerdict = "ok" | "stale" | "never-read" | "missing";

export type CanaryRow = {
  kind: "post" | "creator" | "sound";
  platform: Platform | null;
  label: string;
  url: string | null;
  lastReadAt: string | null;
  hoursSinceRead: number | null;
  snapshots24h: number;
  /** Which metrics carried a non-zero value on the most recent snapshot. A
   *  reader that answers with likes but never views looks healthy by every
   *  other measure — that is exactly the Instagram failure. */
  metricsCarried: string[];
  /** Did anything move across the last three reads? A stored constant read back
   *  every twelve hours produces a perfect row of identical snapshots. */
  moved: boolean | null;
  lastError: string | null;
  verdict: CanaryVerdict;
};

export type CanaryReport = {
  orgId: string;
  campaignId: string | null;
  readCadenceHours: number;
  staleAfterHours: number;
  ok: boolean;
  rows: CanaryRow[];
};

/**
 * The verdict for one canary, given when it was last read.
 *
 * Pure, and separate from the queries, because this is the only part with a
 * decision in it: everything else is a row that either exists or does not.
 */
export function canaryVerdict(input: {
  exists: boolean;
  lastReadAt: Date | null;
  now: Date;
  staleAfterHours: number;
}): CanaryVerdict {
  if (!input.exists) return "missing";
  if (!input.lastReadAt) return "never-read";
  const hours = (input.now.getTime() - input.lastReadAt.getTime()) / (60 * 60 * 1000);
  return hours > input.staleAfterHours ? "stale" : "ok";
}

type MetricBag = {
  viewsCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  sharesCount?: number | null;
  savesCount?: number | null;
};

/** The metric names that actually carried a reading. A zero is not a reading:
 *  every one of these columns defaults to 0, so "shares: 0" and "shares were
 *  never fetched" are the same row. */
export function metricsCarried(snapshot: MetricBag | null): string[] {
  if (!snapshot) return [];
  const pairs: Array<[string, number | null | undefined]> = [
    ["views", snapshot.viewsCount],
    ["likes", snapshot.likesCount],
    ["comments", snapshot.commentsCount],
    ["shares", snapshot.sharesCount],
    ["saves", snapshot.savesCount],
  ];
  return pairs.filter(([, v]) => (v ?? 0) > 0).map(([name]) => name);
}

/** Whether any figure differs across the readings given, newest first. Null
 *  when there are not yet enough readings to say. */
export function movedAcross(readings: MetricBag[]): boolean | null {
  if (readings.length < 2) return null;
  const key = (r: MetricBag) =>
    [r.viewsCount, r.likesCount, r.commentsCount, r.sharesCount, r.savesCount]
      .map((v) => v ?? 0)
      .join("|");
  const first = key(readings[0]);
  return readings.some((r) => key(r) !== first);
}

async function orgCadenceHours(orgId: string): Promise<number> {
  const db = await database();
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
  return READ_CADENCE_HOURS[parsePostTracking(org?.uiConfig).readCadence];
}

/**
 * What every canary row is doing right now.
 *
 * Reads only. This is the endpoint a person hits to answer "is anything
 * broken", so it must never be the thing that breaks: a platform with no canary
 * provisioned is reported as `missing`, not as an error.
 */
export async function canaryReport(orgId: string, now = new Date()): Promise<CanaryReport> {
  const db = await database();
  const readCadenceHours = await orgCadenceHours(orgId);
  const staleAfterHours = readCadenceHours * STALE_AFTER_READS;

  const campaign = await db.campaign.findFirst({
    where: { orgId, title: CANARY_CAMPAIGN_TITLE, deletedAt: null },
    select: { id: true },
  });

  const rows: CanaryRow[] = [];
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const posts = campaign
    ? await db.post.findMany({
        where: { campaignId: campaign.id },
        select: {
          id: true,
          platform: true,
          postUrl: true,
          lastSyncedAt: true,
          trackingEnabled: true,
          snapshots: {
            orderBy: { recordedAt: "desc" },
            take: 3,
            select: {
              recordedAt: true,
              viewsCount: true,
              likesCount: true,
              commentsCount: true,
              sharesCount: true,
              savesCount: true,
            },
          },
        },
      })
    : [];

  for (const post of posts) {
    const latest = post.snapshots[0] ?? null;
    const lastReadAt = latest?.recordedAt ?? post.lastSyncedAt ?? null;
    rows.push({
      kind: "post",
      platform: post.platform,
      label: `${post.platform} post`,
      url: post.postUrl,
      lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
      hoursSinceRead: lastReadAt
        ? Math.round(((now.getTime() - lastReadAt.getTime()) / 3_600_000) * 10) / 10
        : null,
      snapshots24h: post.snapshots.filter((s) => s.recordedAt >= dayAgo).length,
      metricsCarried: metricsCarried(latest),
      moved: movedAcross(post.snapshots),
      /* A tracker somebody turned off is not a reader problem, and saying so
         here is the difference between "Instagram is down" and "somebody
         untracked the canary". */
      lastError: post.trackingEnabled ? null : "tracking is off for this canary post",
      verdict: canaryVerdict({
        exists: post.trackingEnabled,
        lastReadAt,
        now,
        staleAfterHours,
      }),
    });
  }

  /* A platform with no canary row is the case this whole surface exists to
     catch, and a report that simply omits it reads as green. Every platform we
     have a post reader for gets a row whether or not anybody provisioned one. */
  for (const platform of CANARY_POST_PLATFORMS) {
    if (posts.some((p) => p.platform === platform)) continue;
    rows.push({
      kind: "post",
      platform,
      label: `${platform} post`,
      url: null,
      lastReadAt: null,
      hoursSinceRead: null,
      snapshots24h: 0,
      metricsCarried: [],
      moved: null,
      lastError: null,
      verdict: "missing",
    });
  }

  const creators = await db.creator.findMany({
    where: { orgId, deletedAt: null, trackedSince: { not: null } },
    select: {
      id: true,
      handle: true,
      platform: true,
      trackerLastAttemptAt: true,
      trackerLastError: true,
      trackerSnapshots: {
        orderBy: { recordedAt: "desc" },
        take: 3,
        select: { recordedAt: true, followersCount: true, avgViews: true },
      },
    },
  });

  /* The canary creators are the authors of the canary posts: the roster row a
     canary post creates is the creator tracker, so there is one per platform
     without a second set of rows to keep in step. */
  const canaryCreatorIds = new Set(
    campaign
      ? (
          await db.post.findMany({
            where: { campaignId: campaign.id },
            select: { creatorId: true },
          })
        ).map((p) => p.creatorId)
      : [],
  );

  for (const creator of creators.filter((c) => canaryCreatorIds.has(c.id))) {
    const latest = creator.trackerSnapshots[0] ?? null;
    /* A snapshot is written only on a success, so the snapshot is the read.
       trackerLastAttemptAt is reported separately below rather than standing in
       for it -- an account attempted every twelve hours and never readable is
       the failure this row exists to show, not a fresh reading. */
    const lastReadAt = latest?.recordedAt ?? null;
    rows.push({
      kind: "creator",
      platform: creator.platform,
      label: `${creator.platform} creator @${creator.handle.replace(/^@/, "")}`,
      url: null,
      lastReadAt: lastReadAt ? lastReadAt.toISOString() : null,
      hoursSinceRead: lastReadAt
        ? Math.round(((now.getTime() - lastReadAt.getTime()) / 3_600_000) * 10) / 10
        : null,
      snapshots24h: creator.trackerSnapshots.filter((s) => s.recordedAt >= dayAgo).length,
      metricsCarried: (latest?.followersCount ?? 0) > 0 ? ["followers"] : [],
      moved: movedAcross(
        creator.trackerSnapshots.map((s) => ({
          viewsCount: s.avgViews,
          likesCount: s.followersCount,
        })),
      ),
      lastError: creator.trackerLastError,
      verdict: canaryVerdict({ exists: true, lastReadAt, now, staleAfterHours }),
    });
  }

  const sound = await db.tikTokSound.findFirst({
    where: { orgId, title: { startsWith: CANARY_SOUND_TITLE_PREFIX } },
    select: {
      id: true,
      platform: true,
      title: true,
      tiktokSoundId: true,
      snapshots: {
        orderBy: { recordedAt: "desc" },
        take: 3,
        select: { recordedAt: true, usesCount: true },
      },
    },
  });

  const soundLatest = sound?.snapshots[0] ?? null;
  rows.push({
    kind: "sound",
    platform: sound?.platform ?? null,
    label: sound ? `${sound.platform} sound ${sound.tiktokSoundId}` : "sound",
    url: null,
    lastReadAt: soundLatest ? soundLatest.recordedAt.toISOString() : null,
    hoursSinceRead: soundLatest
      ? Math.round(((now.getTime() - soundLatest.recordedAt.getTime()) / 3_600_000) * 10) / 10
      : null,
    snapshots24h: sound?.snapshots.filter((s) => s.recordedAt >= dayAgo).length ?? 0,
    metricsCarried: (soundLatest?.usesCount ?? 0) > 0 ? ["uses"] : [],
    moved: movedAcross((sound?.snapshots ?? []).map((s) => ({ viewsCount: s.usesCount }))),
    lastError: null,
    verdict: canaryVerdict({
      exists: Boolean(sound),
      lastReadAt: soundLatest?.recordedAt ?? null,
      now,
      staleAfterHours,
    }),
  });

  return {
    orgId,
    campaignId: campaign?.id ?? null,
    readCadenceHours,
    staleAfterHours,
    ok: rows.every((r) => r.verdict === "ok"),
    rows,
  };
}

/** A post to watch. The handle is optional and almost always unnecessary — but
 *  an Instagram /p/ link names nobody, and the only way to learn the author is
 *  to ask Instagram, which is exactly the thing that is down when somebody
 *  reaches for this. Supplying it makes provisioning independent of the reader
 *  whose health it is meant to report. */
export type CanaryTarget = { url: string; handle?: string };

export type CanaryTargets = {
  /** Posts to watch. One per platform is the point; more than one is allowed
   *  and none is fine — provisioning is additive and re-runnable. */
  postUrls?: Array<string | CanaryTarget>;
  /** A TikTok sound URL, for the audio reader. */
  soundUrl?: string;
};

export type ProvisionOutcome = {
  campaignId: string;
  created: string[];
  found: string[];
  failed: Array<{ target: string; reason: string }>;
};

/**
 * Create whatever the canary is missing, and touch nothing it already has.
 *
 * Idempotent by design: it is meant to be run again after a platform is added,
 * after somebody deletes a row by hand, or simply to check. Every lookup is by
 * the natural key (campaign title, post URL, sound id), so a second run reports
 * `found` and writes nothing.
 */
export async function provisionCanary(
  orgId: string,
  createdById: string,
  targets: CanaryTargets,
): Promise<ProvisionOutcome> {
  const db = await database();
  const [{ detectPlatform }, { fetchPostMetrics }, { countsFrom }, { ensureCreatorForHandle }, { resolveAuthorFromPlatform }, { parseSoundUrl }] =
    await Promise.all([
      import("@/lib/platforms/postUrl"),
      import("@/lib/platforms/fetchPostMetrics"),
      import("@/lib/sync/syncPost"),
      import("@/lib/posts/addPostChecks"),
      import("@/lib/platforms/postAuthor"),
      import("@/lib/trackers/soundUrl"),
    ]);
  const created: string[] = [];
  const found: string[] = [];
  const failed: Array<{ target: string; reason: string }> = [];

  let campaign = await db.campaign.findFirst({
    where: { orgId, title: CANARY_CAMPAIGN_TITLE, deletedAt: null },
    select: { id: true },
  });
  if (campaign) {
    found.push("campaign");
  } else {
    campaign = await db.campaign.create({
      data: {
        orgId,
        createdById,
        title: CANARY_CAMPAIGN_TITLE,
        status: "IN_PROGRESS",
        notes:
          "Platform health check. The posts here are tracked forever so a dead reader shows up " +
          "as a stale canary rather than as a client's missing numbers. Do not delete.",
      },
      select: { id: true },
    });
    created.push("campaign");
  }

  for (const target of targets.postUrls ?? []) {
    const url = (typeof target === "string" ? target : target.url).trim();
    const suppliedHandle = typeof target === "string" ? undefined : target.handle?.trim();
    if (!url) continue;
    try {
      const detected = detectPlatform(url);
      if (!detected) {
        failed.push({ target: url, reason: "no platform could be read from that URL" });
        continue;
      }

      const existing = await db.post.findFirst({
        where: { campaignId: campaign.id, postUrl: url },
        select: { id: true, trackingEnabled: true, trackingExpiresAt: true },
      });
      if (existing) {
        /* Re-running must repair a canary somebody switched off or let expire,
           which is the whole reason this is safe to run repeatedly. */
        if (
          !existing.trackingEnabled ||
          existing.trackingExpiresAt?.getTime() !== CANARY_TRACKING_EXPIRES_AT.getTime()
        ) {
          await db.post.update({
            where: { id: existing.id },
            data: {
              trackingEnabled: true,
              trackingStartedAt: new Date(),
              trackingExpiresAt: CANARY_TRACKING_EXPIRES_AT,
              trackingTtlDays: null,
            },
          });
          created.push(`${detected.platform} post tracking repaired`);
        } else {
          found.push(`${detected.platform} post`);
        }
        continue;
      }

      /* The handle comes from the link where the link carries one, and from the
         platform where it does not (a YouTube watch URL names no channel).
         Both paths are the ones the Add Post dialog uses. */
      const handle =
        suppliedHandle?.replace(/^@/, "") ||
        detected.handle?.replace(/^@/, "") ||
        (await resolveAuthorFromPlatform(url, detected.platform))?.handle ||
        null;
      if (!handle) {
        failed.push({ target: url, reason: "no creator handle could be resolved for that URL" });
        continue;
      }

      const { creator } = await ensureCreatorForHandle(orgId, handle, detected.platform);

      /* Fetched here rather than left to the cron, because a canary that cannot
         be read at all should fail at provisioning time, in front of the person
         running it, instead of looking healthy until the first sweep. */
      const metrics = await fetchPostMetrics(url).catch(() => null);
      const counts = metrics ? countsFrom(metrics) : null;

      await db.post.create({
        data: {
          campaignId: campaign.id,
          creatorId: creator.id,
          platform: detected.platform,
          platformPostId: metrics?.platformPostId ?? detected.id,
          postUrl: url,
          thumbnailUrl: metrics?.thumbnailUrl ?? null,
          caption: metrics?.caption ?? null,
          mediaType: detected.mediaType ?? null,
          ...(counts ? counts.counts : {}),
          ...(counts ? { platformMetrics: counts.measuredPatch } : {}),
          engagementRate: metrics?.engagementRate ?? 0,
          postedAt: metrics?.postedAt ?? new Date(),
          lastSyncedAt: counts && Object.keys(counts.counts).length > 0 ? new Date() : null,
          status: "APPROVED",
          trackingEnabled: true,
          trackingStartedAt: new Date(),
          trackingExpiresAt: CANARY_TRACKING_EXPIRES_AT,
        },
      });
      created.push(`${detected.platform} post`);

      /* The author of a canary post is the canary creator tracker. One roster
         row serves both, so the two can never drift onto different accounts. */
      const creatorRow = await db.creator.findUnique({
        where: { id: creator.id },
        select: { trackedSince: true },
      });
      if (!creatorRow?.trackedSince) {
        await db.creator.update({
          where: { id: creator.id },
          data: { trackedSince: new Date() },
        });
        created.push(`${detected.platform} creator tracker`);
      } else {
        found.push(`${detected.platform} creator tracker`);
      }
    } catch (err) {
      failed.push({ target: url, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (targets.soundUrl?.trim()) {
    const parsed = parseSoundUrl(targets.soundUrl.trim());
    if (parsed.kind !== "sound") {
      failed.push({ target: targets.soundUrl, reason: "that is not a sound URL" });
    } else if (parsed.platform === "INSTAGRAM") {
      /* No reader serves Instagram audio — lib/trackers/soundUrl says so and the
         trackers route refuses it. A canary for a reader that does not exist
         would be permanently red for no reason. */
      failed.push({ target: targets.soundUrl, reason: "no reader exists for Instagram audio" });
    } else {
      const already = await db.tikTokSound.findFirst({
        where: { orgId, platform: parsed.platform, tiktokSoundId: parsed.tiktokSoundId },
        select: { id: true },
      });
      if (already) {
        found.push("sound");
      } else {
        /* Deliberately not subject to trackerLimitError: the canary is the
           platform's own instrument, and a plan limit removing the health check
           exactly when an org is at its ceiling is the wrong failure. */
        await db.tikTokSound.create({
          data: {
            orgId,
            platform: parsed.platform,
            tiktokSoundId: parsed.tiktokSoundId,
            title: `${CANARY_SOUND_TITLE_PREFIX} ${parsed.provisionalTitle ?? parsed.tiktokSoundId}`,
            artist: "",
          },
        });
        created.push("sound");
      }
    }
  }

  return { campaignId: campaign.id, created, found, failed };
}
