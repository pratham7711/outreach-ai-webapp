import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { recordTopPosts, tikTokCreatorsNeedingTopPosts } from "@/lib/creators/topPosts";
import { createLogger } from "@/lib/observability/logger";

/**
 * The creator tracker's way in for TikTok Top Posts, read by a box that is not
 * this server.
 *
 * Profile STATS run fine from here (a Sandbox curl gets the server-rendered
 * page). The post GRID does not, and the reason is narrower than "a browser":
 * `/api/post/item_list/` answers 200 with a ZERO-BYTE body unless the request
 * carries TikTok's signing params, and it did so in every configuration
 * measured from Vercel egress on 2026-09-01 — @sparticuz/chromium headless,
 * google-chrome new-headless, and google-chrome headed under Xvfb alike.
 *
 * (A caution paid for the hard way: `/api/repost/item_list/` DOES return 30
 * items from the same page visit. They are the creator's reposts, authored by
 * other people. Matching the endpoint on the substring "item_list" silently
 * fills Top Posts with someone else's videos, which is worse than an empty
 * panel. Match the exact path.)
 *
 * The grid, however, turned out not to be the only way in: TikTok's embed page
 * (`/embed/@handle`) server-renders the creator's own video list for anyone,
 * and that is what actually ships Top Posts today — see
 * `lib/platforms/tiktokTopPostsEmbed.ts`. This route stays because the embed
 * page carries no like counts, comment counts or dates, and because a reader
 * on a box outside a hyperscaler's ranges is still the fallback if TikTok
 * closes it. scripts/creator-worker/ is that box, unprovisioned by choice.
 *
 * Same deliberate boundaries as that route:
 *  - The worker never gets DATABASE_URL; it holds one bearer token.
 *  - No second copy of the ranking arithmetic: posts land through the same
 *    rankTopPosts the in-process readers use.
 *  - Empty lists are never written over stored posts — an unread grid is
 *    "not measured", not "no posts".
 */

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
  return NextResponse.json({ creators: await tikTokCreatorsNeedingTopPosts() });
}

export async function POST(request: NextRequest) {
  if (!isAuthorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const log = createLogger({ context: { route: "trackers/creators/ingest" } });

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { readings, dryRun } = parsed.data;

  const result = await recordTopPosts(
    readings.map((r) => ({
      creatorId: r.creatorId,
      posts: r.posts.map((p) => ({
        postId: p.postId,
        url: p.url,
        caption: p.caption ?? null,
        coverUrl: p.coverUrl ?? null,
        views: p.views ?? null,
        likes: p.likes ?? null,
        comments: p.comments ?? null,
        postedAt: p.postedAt ?? null,
      })),
    })),
    { dryRun: Boolean(dryRun) }
  );

  log.info("creator top-posts ingest", { ...result, dryRun: Boolean(dryRun) });
  return NextResponse.json({ ...result, dryRun: Boolean(dryRun) });
}
