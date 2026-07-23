import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  detectPlatform,
  fetchPostMetrics,
  fetchYouTubeMetricsBatch,
  hasMetricCounts,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";
import { decryptInstagramToken } from "@/lib/platforms/instagramToken";
import { decideSyncAction, SyncAction } from "@/lib/sync/cadence";
import { createLogger } from "@/lib/observability/logger";

const MAX_SYNC_FAILURES = 5;
const DEFAULT_PLATFORM_BUDGET = 100;

type Decision = { postId: string; platform: string; action: SyncAction; reason: string };

function parseBudget(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PLATFORM_BUDGET;
}

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-posts" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const deadline = Date.now() + 4 * 60 * 1000;

  const budgets: Record<string, number> = {
    YOUTUBE: parseBudget(process.env.SYNC_BUDGET_YOUTUBE),
    TIKTOK: parseBudget(process.env.SYNC_BUDGET_TIKTOK),
    INSTAGRAM: parseBudget(process.env.SYNC_BUDGET_INSTAGRAM),
  };
  const attempts: Record<string, number> = {};

  let synced = 0;
  let sealed = 0;
  let failed = 0;
  let deadLettered = 0;
  let skippedForBudget = 0;
  const decisions: Decision[] = [];

  try {
    const posts = await db.post.findMany({
      where: {
        campaign: {
          status: { in: ["IN_PROGRESS", "PENDING"] },
          deletedAt: null,
        },
      },
      select: {
        id: true,
        platform: true,
        postUrl: true,
        postedAt: true,
        lastSyncedAt: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        engagementRate: true,
        syncFailCount: true,
        syncDisabledAt: true,
        trackingEnabled: true,
        trackingStartedAt: true,
        snapshots: { where: { isFinalSnapshot: true }, take: 1, select: { id: true } },
        creator: {
          select: {
            orgId: true,
            handle: true,
            socialAccounts: {
              where: { platform: "INSTAGRAM" },
              select: { accessToken: true, handle: true },
            },
          },
        },
      },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: 300,
    });

    const youtubeIds: string[] = [];
    for (const p of posts) {
      if (p.platform !== "YOUTUBE") continue;
      const d = detectPlatform(p.postUrl);
      if (d?.platform === "YOUTUBE") youtubeIds.push(d.id);
    }
    const youtubeCache: Map<string, PostMetrics> = dryRun
      ? new Map()
      : await fetchYouTubeMetricsBatch(youtubeIds);

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!dryRun && Date.now() > deadline) {
        skippedForBudget += posts.length - i;
        break;
      }

      let { action, reason } = decideSyncAction({
        postedAt: new Date(post.postedAt),
        lastSyncedAt: post.lastSyncedAt ? new Date(post.lastSyncedAt) : null,
        syncFailCount: post.syncFailCount,
        syncDisabledAt: post.syncDisabledAt ? new Date(post.syncDisabledAt) : null,
        hasFinalSnapshot: post.snapshots.length > 0,
        trackingEnabled: post.trackingEnabled ?? false,
        trackingStartedAt: post.trackingStartedAt ? new Date(post.trackingStartedAt) : null,
        now,
      });

      if (action === "sync") {
        const platform = post.platform as string;
        const budget = budgets[platform] ?? DEFAULT_PLATFORM_BUDGET;
        const used = attempts[platform] ?? 0;
        if (used >= budget) {
          action = "skip";
          reason = "budget";
        } else {
          attempts[platform] = used + 1;
        }
      }

      decisions.push({ postId: post.id, platform: post.platform as string, action, reason });

      if (dryRun) continue;

      if (action === "skip") {
        if (reason === "budget") skippedForBudget++;
        continue;
      }

      if (action === "seal") {
        try {
          await db.$transaction([
            db.postMetricSnapshot.create({
              data: {
                postId: post.id,
                viewsCount: post.viewsCount,
                likesCount: post.likesCount,
                commentsCount: post.commentsCount,
                sharesCount: post.sharesCount,
                engagementRate: post.engagementRate,
                isFinalSnapshot: true,
                syncSource: "cron-seal",
              },
            }),
            db.post.update({ where: { id: post.id }, data: { lastSyncedAt: now } }),
          ]);
          sealed++;
        } catch (err) {
          log.error("failed to seal post", { postId: post.id, error: String(err) });
          failed++;
        }
        continue;
      }

      try {
        const instagramToken =
          post.platform === "INSTAGRAM"
            ? decryptInstagramToken(post.creator.socialAccounts[0]?.accessToken, post.creator.orgId)
            : undefined;
        const instagramHandle =
          post.platform === "INSTAGRAM"
            ? (post.creator.socialAccounts[0]?.handle ?? post.creator.handle ?? undefined)
            : undefined;
        const detected = post.platform === "YOUTUBE" ? detectPlatform(post.postUrl) : null;
        const cached = detected ? youtubeCache.get(detected.id) : undefined;
        const metrics =
          cached ?? (await fetchPostMetrics(post.postUrl, { instagramToken, instagramHandle }));
        if (!metrics) continue;

        const postData: Record<string, unknown> = { lastSyncedAt: now, syncFailCount: 0 };
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
        log.error("failed to sync post", { postId: post.id, error: String(err) });
        failed++;
        const nextFailCount = post.syncFailCount + 1;
        const failData: Record<string, unknown> = { syncFailCount: nextFailCount };
        if (nextFailCount >= MAX_SYNC_FAILURES) {
          failData.syncDisabledAt = now;
          deadLettered++;
        }
        try {
          await db.post.update({ where: { id: post.id }, data: failData });
        } catch (updateErr) {
          log.error("failed to record sync failure", { postId: post.id, error: String(updateErr) });
        }
      }
    }

    if (dryRun) {
      const byAction: Record<string, number> = {};
      const byReason: Record<string, number> = {};
      for (const d of decisions) {
        byAction[d.action] = (byAction[d.action] ?? 0) + 1;
        byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      }
      log.info("dry-run complete", { total: posts.length, byAction, byReason });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        total: posts.length,
        decisions,
        summary: { byAction, byReason },
      });
    }

    log.info("sync complete", { synced, sealed, failed, deadLettered, skippedForBudget, total: posts.length });
    return NextResponse.json({
      ok: true,
      synced,
      sealed,
      failed,
      deadLettered,
      skippedForBudget,
      total: posts.length,
    });
  } catch (error) {
    log.error("cron run failed", { error: String(error) });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
