import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { analyzePostForFraud, fraudFlagKey, type DetectedFlag } from "@/lib/fraud-detection";
import { fieldMetricValue, readableSnapshots, snapshotMetric, snapshotViewsKnown } from "@/lib/metricDisplay";

/**
 * The view check, run from two places: the campaign's own scan
 * (POST /api/campaigns/[id]/fraud-scan) and the post sweep, for the posts it
 * has just measured. A flag is raised once per post, rule and spike; a flag
 * someone marked reviewed is not raised again for the same evidence.
 *
 * Nothing here notifies anyone. A flag is a row the team sees on the Posts
 * tab, and an open one holds a submission back from auto-approval.
 */

export const SCAN_SNAPSHOT_SELECT = {
  id: true,
  recordedAt: true,
  viewsCount: true,
  likesCount: true,
  commentsCount: true,
  sharesCount: true,
  engagementRate: true,
  platformMetrics: true,
} as const;

export type ScanPost = {
  id: string;
  campaignId: string;
  creatorId: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
  lastSyncedAt?: Date | null;
  platformMetrics?: unknown;
  snapshots: {
    id: string;
    recordedAt: Date;
    viewsCount: number;
    likesCount: number | null;
    commentsCount: number | null;
    sharesCount: number | null;
    engagementRate: number;
    platformMetrics?: unknown;
  }[];
};

/** A reading that measured both views and likes. */
function engagementRead(s: { viewsCount: number | null; likesCount: number | null; platformMetrics?: unknown }): boolean {
  return snapshotViewsKnown(s) && snapshotMetric(s.likesCount, s.platformMetrics, "likes") !== null;
}

/**
 * The rules' findings for one post.
 *
 * LOW_ENGAGEMENT and BOT_PATTERN divide likes by views. A like count stored as
 * 0 because it was never read (hidden on Instagram, or a reader that does not
 * return it) would make every large post look like a bot, so those two rules
 * only count when the post's likes were actually measured. VIEW_SPIKE judges
 * only pairs of readings that both measured likes (engagementRead).
 */
export function detectPostFlags(post: ScanPost): DetectedFlag[] {
  const flags = analyzePostForFraud(
    {
      id: post.id,
      campaignId: post.campaignId,
      creatorId: post.creatorId,
      viewsCount: post.viewsCount,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      sharesCount: post.sharesCount,
      engagementRate: post.engagementRate,
    },
    /* Only readings that measured BOTH views and likes. A placeholder 0
       between two real readings is a collapse and then a "spike"; and a
       views-only reading after a real jump, its likes held at the last known
       level, shows the new views arriving with no engagement at all -- which
       is exactly the rule's signal, on an honest post. A pair is only judged
       where both sides read the engagement it compares. */
    readableSnapshots(post.snapshots.filter(engagementRead)).map((s) => ({
      id: s.id,
      viewsCount: s.viewsCount,
      likesCount: s.likesCount ?? 0,
      commentsCount: s.commentsCount ?? 0,
      sharesCount: s.sharesCount ?? 0,
      engagementRate: s.engagementRate,
      recordedAt: s.recordedAt,
    })),
  );
  const likesKnown = fieldMetricValue(post.likesCount, post.lastSyncedAt ?? null, post.platformMetrics, "likes") !== null;
  return likesKnown ? flags : flags.filter((f) => f.flagType === "VIEW_SPIKE");
}

/** Raises the flags these posts have not had yet, all in one org. */
export async function raiseFraudFlags(orgId: string, posts: readonly ScanPost[]) {
  const created: Awaited<ReturnType<typeof db.viewFraudFlag.create>>[] = [];
  let skipped = 0;
  if (posts.length === 0) return { created, skipped };

  const existing = await db.viewFraudFlag.findMany({
    where: { orgId, postId: { in: posts.map((p) => p.id) } },
    select: { postId: true, flagType: true, evidence: true },
  });
  const seen = new Set(existing.map((f) => fraudFlagKey(f.postId, f.flagType, f.evidence)));

  for (const post of posts) {
    for (const flag of detectPostFlags(post)) {
      const key = fraudFlagKey(post.id, flag.flagType, flag.evidence);
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      created.push(
        await db.viewFraudFlag.create({
          data: {
            orgId,
            campaignId: post.campaignId,
            creatorId: post.creatorId,
            postId: post.id,
            flagType: flag.flagType,
            severity: flag.severity,
            description: flag.description,
            evidence: flag.evidence as object,
          },
        }),
      );
    }
  }
  return { created, skipped };
}

const SWEEP_SCAN_CHUNK = 50;
/** The sweep judges a post on its newest readings, which include the one it
    just stored: a spike between those is new, one further back was there on
    every earlier run. Bounds each chunk's read to 50 x this many rows. */
export const SWEEP_SCAN_READINGS = 10;

/**
 * The sweep's pass: the posts it measured this run, read back with their
 * newest readings in chunks, flagged per org. Stops between chunks once
 * `stopAtMs` has passed; a post it does not reach is checked on its next
 * reading.
 */
export async function scanSweptPosts(postIds: readonly string[], options: { stopAtMs?: number } = {}) {
  let scanned = 0;
  let flagged = 0;
  let stopped = false;
  for (let i = 0; i < postIds.length; i += SWEEP_SCAN_CHUNK) {
    if (options.stopAtMs !== undefined && Date.now() > options.stopAtMs) {
      stopped = true;
      break;
    }
    const chunk = postIds.slice(i, i + SWEEP_SCAN_CHUNK);
    const posts = await db.post.findMany({
      where: { id: { in: [...chunk] }, ...NOT_REMOVED },
      select: {
        id: true,
        campaignId: true,
        creatorId: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        engagementRate: true,
        lastSyncedAt: true,
        platformMetrics: true,
        campaign: { select: { orgId: true } },
        snapshots: { orderBy: { recordedAt: "desc" }, take: SWEEP_SCAN_READINGS, select: SCAN_SNAPSHOT_SELECT },
      },
    });
    const byOrg = new Map<string, ScanPost[]>();
    for (const row of posts) {
      const post = { ...row, snapshots: [...row.snapshots].reverse() };
      const list = byOrg.get(post.campaign.orgId) ?? [];
      list.push(post);
      byOrg.set(post.campaign.orgId, list);
    }
    for (const [orgId, list] of byOrg) {
      const { created } = await raiseFraudFlags(orgId, list);
      flagged += created.length;
    }
    scanned += posts.length;
  }
  return { scanned, flagged, stopped };
}
