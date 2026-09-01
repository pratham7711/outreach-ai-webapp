import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { rankTopPosts, type TopPost } from "@/lib/platforms/creatorProfile";

/**
 * Recording a creator's top posts — the one copy of this arithmetic.
 *
 * Two callers reach it: the HTTP ingest endpoint (a VPS worker with real
 * Chrome) and the daily cron (a Vercel Sandbox with real Chrome). Both hand
 * over a raw post list and neither decides what it means. The ranking, the
 * six-post cap and the refusal to overwrite stored posts with an empty read
 * live here, because the last time snapshot arithmetic existed in two places a
 * sound with 46 uses reported "+100 videos added" on a client's report.
 */

export type TopPostsReading = {
  creatorId: string;
  posts: TopPost[];
};

export type RecordResult = { recorded: number; unknown: number; empty: number };

export async function recordTopPosts(
  readings: TopPostsReading[],
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<RecordResult> {
  let recorded = 0;
  let unknown = 0;
  let empty = 0;

  for (const reading of readings) {
    /* An empty list is "not measured", never "no posts" — a creator whose grid
       failed keeps the posts we already have. */
    if (!reading.posts.length) {
      empty += 1;
      continue;
    }

    /* Existence re-checked per reading rather than trusted: a worker's list can
       predate an untrack or a delete by most of a day. */
    const creator = await db.creator.findFirst({
      where: { id: reading.creatorId, platform: "TIKTOK", deletedAt: null },
      select: { id: true },
    });
    if (!creator) {
      unknown += 1;
      continue;
    }

    const topPosts = rankTopPosts(reading.posts);

    if (!dryRun) {
      await db.creator.update({
        where: { id: creator.id },
        data: {
          topPosts: topPosts as unknown as Prisma.InputJsonValue,
          topPostsAt: new Date(),
        },
      });
    }
    recorded += 1;
  }

  return { recorded, unknown, empty };
}

/** How recently a grid must have been read for losing it to count as an outage
    rather than a stale row. Generous: the readers run daily. */
export const TOP_POSTS_LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type TrackedTikTokCreator = {
  id: string;
  handle: string;
  name: string;
  readRecently: boolean;
};

/**
 * Which creators a grid reader should read, oldest-read first.
 *
 * Only TikTok: the other platforms' top posts come free with reads the app
 * already makes itself. Ordered by topPostsAt so a roster larger than one run
 * can cover cycles through rather than re-reading the same head every day.
 */
export async function tikTokCreatorsNeedingTopPosts(
  limit?: number
): Promise<TrackedTikTokCreator[]> {
  const now = Date.now();
  const creators = await db.creator.findMany({
    where: { platform: "TIKTOK", trackedSince: { not: null }, deletedAt: null },
    select: { id: true, handle: true, name: true, topPostsAt: true },
    orderBy: [{ topPostsAt: { sort: "asc", nulls: "first" } }, { trackedSince: "asc" }],
    ...(limit ? { take: limit } : {}),
  });

  return creators.map((c) => ({
    id: c.id,
    handle: c.handle,
    name: c.name,
    readRecently: Boolean(c.topPostsAt && now - c.topPostsAt.getTime() < TOP_POSTS_LIVE_WINDOW_MS),
  }));
}
