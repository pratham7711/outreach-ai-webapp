import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { fieldMetricValue } from "@/lib/metricDisplay";
import { stripAt } from "@/lib/format";

export const dynamic = "force-dynamic";

/** How far back the followers trend reaches. */
const TREND_DAYS = 180;
/** Points per profile; the tracker reads at most daily, so this covers the window. */
const TREND_POINTS = 200;
const CAMPAIGN_POSTS = 30;

/**
 * GET /api/portal/stats -- the parts of My stats that come from our own
 * database rather than a live platform call. The live per-account blocks
 * (recent posts, best post, Facebook Page views and comments) come from
 * /api/portal/insights; this adds the two things that need history:
 *
 *  - FOLLOWERS TREND, from the tracker's readings of the creator's public
 *    profile (CreatorTrackerSnapshot). A connected account stores only its
 *    latest count, so the snapshots are the only series there is. One line per
 *    profile: an agency tracking the same handle in two orgs reads the same
 *    public profile, so their readings are merged rather than drawn twice.
 *  - CAMPAIGN POSTS with Instagram reach and saves. Reach and saves are read
 *    for posts submitted to a campaign (lib/platforms/instagram.ts), and each
 *    value goes through fieldMetricValue so a column default of 0 is never
 *    shown as a measured zero.
 *
 * Gated on proven ownership like every other read of a creator's own data
 * (lib/portal/creatorLink.ts).
 */
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const linked = await findLinkedCreatorsForHandle(session);
    if (linked.length === 0) return NextResponse.json({ trends: [], campaignPosts: [] });
    const ids = linked.map((c) => c.id);

    const since = new Date(Date.now() - TREND_DAYS * 24 * 60 * 60 * 1000);
    const [rows, posts] = await Promise.all([
      db.creator.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          platform: true,
          handle: true,
          trackerSnapshots: {
            where: { recordedAt: { gte: since }, followersCount: { gt: 0 } },
            select: { followersCount: true, recordedAt: true },
            orderBy: { recordedAt: "desc" },
            take: TREND_POINTS,
          },
        },
      }),
      db.post.findMany({
        where: { creatorId: { in: ids }, campaign: { deletedAt: null } },
        select: {
          id: true,
          platform: true,
          postUrl: true,
          caption: true,
          thumbnailUrl: true,
          postedAt: true,
          viewsCount: true,
          likesCount: true,
          commentsCount: true,
          reachCount: true,
          savesCount: true,
          lastSyncedAt: true,
          platformMetrics: true,
          campaign: { select: { title: true } },
        },
        orderBy: { postedAt: "desc" },
        take: CAMPAIGN_POSTS,
      }),
    ]);

    const trendByKey = new Map<
      string,
      { platform: string; handle: string; points: Map<string, { at: number; followers: number }> }
    >();
    for (const row of rows) {
      if (row.trackerSnapshots.length === 0) continue;
      const handle = stripAt(row.handle);
      const key = `${row.platform}:${handle.toLowerCase()}`;
      const entry = trendByKey.get(key) ?? { platform: row.platform, handle, points: new Map() };
      for (const s of row.trackerSnapshots) {
        /* One point per day: two orgs reading the same profile on the same day
           are the same reading twice. The later one wins -- by recordedAt, not
           by arrival: the rows come newest first, so "last written" was the
           day's EARLIEST reading, and across two orgs it was whichever row
           Prisma returned second. */
        const day = s.recordedAt.toISOString().slice(0, 10);
        const at = s.recordedAt.getTime();
        const held = entry.points.get(day);
        if (!held || at >= held.at) entry.points.set(day, { at, followers: s.followersCount });
      }
      trendByKey.set(key, entry);
    }
    const trends = [...trendByKey.values()].map((t) => ({
      platform: t.platform,
      handle: t.handle,
      source: "public_profile" as const,
      points: [...t.points.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, { followers }]) => ({ day, followers })),
    }));

    const campaignPosts = posts.map((p) => {
      const field = (value: number, name: "views" | "likes" | "comments" | "reach" | "saves") =>
        fieldMetricValue(value, p.lastSyncedAt, p.platformMetrics, name);
      return {
        id: p.id,
        platform: p.platform,
        postUrl: p.postUrl,
        caption: p.caption,
        thumbnailUrl: p.thumbnailUrl,
        postedAt: p.postedAt.toISOString(),
        campaignTitle: p.campaign.title,
        views: field(p.viewsCount, "views"),
        likes: field(p.likesCount, "likes"),
        comments: field(p.commentsCount, "comments"),
        /* Reach and saves are Instagram insights; on any other platform the
           column is a default, not a reading. */
        reach: p.platform === "INSTAGRAM" ? field(p.reachCount, "reach") : null,
        saves: p.platform === "INSTAGRAM" ? field(p.savesCount, "saves") : null,
        lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ trends, campaignPosts });
  } catch (error) {
    console.error("Failed to build creator stats:", error);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
