import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { fetchPostMetrics, hasMetricCounts } from "@/lib/platforms/fetchPostMetrics";

// GET /api/cron/sync-posts — Hourly cron job to sync post metrics
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  let synced = 0;
  let failed = 0;

  try {
    // Get posts from active campaigns that need syncing
    const posts = await db.post.findMany({
      where: {
        campaign: {
          status: { in: ["IN_PROGRESS", "PENDING"] },
          deletedAt: null,
        },
      },
      select: {
        id: true,
        postUrl: true,
        postedAt: true,
        lastSyncedAt: true,
        viewsCount: true,
      },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    });

    for (const post of posts) {
      // Variable cadence based on post age
      const ageMs = now.getTime() - new Date(post.postedAt).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);
      const lastSyncMs = post.lastSyncedAt
        ? now.getTime() - new Date(post.lastSyncedAt).getTime()
        : Infinity;
      const lastSyncHours = lastSyncMs / (1000 * 60 * 60);

      // Skip based on cadence: <24h always, 1-7d if >6h stale, 7-30d if >24h stale, >30d skip
      if (ageHours > 30 * 24) continue;
      if (ageHours > 7 * 24 && lastSyncHours < 24) continue;
      if (ageHours > 24 && lastSyncHours < 6) continue;

      try {
        const metrics = await fetchPostMetrics(post.postUrl);
        if (!metrics) continue;

        const postData: Record<string, unknown> = { lastSyncedAt: now };
        if (metrics.thumbnailUrl !== null) postData.thumbnailUrl = metrics.thumbnailUrl;
        if (metrics.caption !== null) postData.caption = metrics.caption;

        if (hasMetricCounts(metrics)) {
          const views = metrics.viewsCount ?? 0;
          const likes = metrics.likesCount ?? 0;
          const comments = metrics.commentsCount ?? 0;
          const shares = metrics.sharesCount ?? 0;
          const engagementRate =
            metrics.engagementRate ?? (views > 0 ? ((likes + comments) / views) * 100 : 0);
          postData.viewsCount = views;
          postData.likesCount = likes;
          postData.commentsCount = comments;
          postData.sharesCount = shares;
          postData.engagementRate = engagementRate;

          await db.$transaction([
            db.post.update({ where: { id: post.id }, data: postData }),
            db.postMetricSnapshot.create({
              data: {
                postId: post.id,
                viewsCount: views,
                likesCount: likes,
                commentsCount: comments,
                sharesCount: shares,
                engagementRate,
                syncSource: "cron",
              },
            }),
          ]);
        } else {
          await db.post.update({ where: { id: post.id }, data: postData });
        }
        synced++;
      } catch (err) {
        console.error(`Failed to sync post ${post.id}:`, err);
        failed++;
        // Continue with other posts
      }
    }

    return NextResponse.json({ ok: true, synced, failed, total: posts.length });
  } catch (error) {
    console.error("Cron sync-posts failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
