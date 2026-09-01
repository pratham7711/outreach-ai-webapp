import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { rankTopPosts, type TopPost } from "@/lib/platforms/creatorProfile";
import { createLogger } from "@/lib/observability/logger";

/**
 * The creator tracker's way in for TikTok Top Posts, read by a box that is not
 * this server.
 *
 * Profile STATS run fine from here (a Sandbox curl gets the server-rendered
 * page). The post GRID does not, from anywhere serverless: /api/post/item_list/
 * is signed by TikTok's client script, and that script refuses to produce the
 * tokens under headless SwiftShader Chromium even from clean Sandbox egress —
 * measured, not assumed. What passes is a real Chrome on a real box outside
 * India. So the grid read happens there and lands here, exactly the shape the
 * sound worker already established (see app/api/trackers/sounds/ingest).
 *
 * Same deliberate boundaries as that route:
 *  - The worker never gets DATABASE_URL; it holds one bearer token.
 *  - No second copy of the ranking arithmetic: posts land through the same
 *    rankTopPosts the in-process readers use.
 *  - Empty lists are never written over stored posts — an unread grid is
 *    "not measured", not "no posts".
 */

/** How recently a creator's grid must have been read for losing it to count as
    an outage rather than a stale row. The worker's timer is daily; a month of
    alerting before going quiet, same reasoning as the sound ingest. */
const LIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const PostSchema = z.object({
  postId: z.string().min(1).max(64),
  url: z.string().url().max(500),
  caption: z.string().max(2_000).nullish(),
  coverUrl: z.string().url().max(1_000).nullish(),
  views: z.number().int().nonnegative().nullish(),
  likes: z.number().int().nonnegative().nullish(),
  comments: z.number().int().nonnegative().nullish(),
  postedAt: z.string().datetime().nullish(),
});

const ReadingSchema = z.object({
  creatorId: z.string().min(1),
  posts: z.array(PostSchema).min(1).max(60),
});

const BodySchema = z.object({
  readings: z.array(ReadingSchema).min(1).max(200),
  dryRun: z.boolean().optional(),
});

/** CREATOR_INGEST_TOKEN, else the sound worker's token, else CRON_SECRET —
    works the moment it deploys, and can be narrowed without a code change. */
function isAuthorised(request: NextRequest): boolean {
  const expected =
    process.env.CREATOR_INGEST_TOKEN ?? process.env.SOUND_INGEST_TOKEN ?? process.env.CRON_SECRET;
  if (!expected) return false;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

/**
 * GET — which creators to read.
 *
 * The worker asks rather than being told: tracking a creator in the UI is
 * enough to get their grid read on the next timer. Only TikTok rows go over
 * the wire — the other platforms' top posts come free with reads the app
 * already makes itself.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = Date.now();
  const creators = await db.creator.findMany({
    where: { platform: "TIKTOK", trackedSince: { not: null }, deletedAt: null },
    select: { id: true, handle: true, name: true, topPostsAt: true },
    orderBy: { trackedSince: "asc" },
  });

  return NextResponse.json({
    creators: creators.map((c) => ({
      id: c.id,
      handle: c.handle,
      name: c.name,
      /* readRecently is the worker's outage/stale split, computed here so the
         window lives beside the data rather than on the remote box. */
      readRecently: Boolean(c.topPostsAt && now - c.topPostsAt.getTime() < LIVE_WINDOW_MS),
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const log = createLogger({ context: { route: "trackers/creators/ingest" } });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { readings, dryRun } = parsed.data;

  let recorded = 0;
  let unknown = 0;

  for (const reading of readings) {
    /* Existence re-checked per reading rather than trusted: the list the worker
       is holding may predate an untrack or a delete by most of a day. */
    const creator = await db.creator.findFirst({
      where: { id: reading.creatorId, platform: "TIKTOK", deletedAt: null },
      select: { id: true },
    });
    if (!creator) {
      unknown += 1;
      continue;
    }

    const topPosts: TopPost[] = rankTopPosts(
      reading.posts.map((p) => ({
        postId: p.postId,
        url: p.url,
        caption: p.caption ?? null,
        coverUrl: p.coverUrl ?? null,
        views: p.views ?? null,
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        postedAt: p.postedAt ?? null,
      }))
    );

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

  log.info("creator top-posts ingest", { recorded, unknown, dryRun: Boolean(dryRun) });
  return NextResponse.json({ recorded, unknown, dryRun: Boolean(dryRun) });
}
