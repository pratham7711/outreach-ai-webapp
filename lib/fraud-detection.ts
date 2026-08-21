import type { FraudFlagType, FraudFlagSeverity } from "@/lib/generated/prisma";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface PostSnapshot {
  id: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
  recordedAt: Date;
}

export interface PostData {
  id: string;
  campaignId: string;
  creatorId: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
}

export interface DetectedFlag {
  flagType: FraudFlagType;
  severity: FraudFlagSeverity;
  description: string;
  evidence: JsonValue;
}

const VIEW_SPIKE_MARGINAL_FLOOR = 0.5;
const VIEW_SPIKE_COLLAPSE_RATIO = 0.2;

function interactionsOf(snapshot: PostSnapshot): number {
  return snapshot.likesCount + snapshot.commentsCount + snapshot.sharesCount;
}

/**
 * Analyze a post and its metric snapshots for potential view fraud.
 *
 * Detection rules:
 * 1. VIEW_SPIKE: >300% view increase between consecutive snapshots AND the added
 *    views brought almost no engagement with them — marginal engagement rate
 *    below min(0.5%, 20% of the post's rate before the spike). Organic virality
 *    carries engagement along with the views, so it does not trip this rule.
 * 2. LOW_ENGAGEMENT: views > 10000 but engagement rate < 0.5%
 * 3. BOT_PATTERN: very high views but likes/comments ratio is abnormally low (<0.1%)
 */
export function analyzePostForFraud(
  post: PostData,
  snapshots: PostSnapshot[]
): DetectedFlag[] {
  const flags: DetectedFlag[] = [];

  // Sort snapshots by recordedAt ascending
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  // Rule 1: VIEW_SPIKE — >300% view increase whose new views carried no engagement
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    if (prev.viewsCount === 0) continue;

    const deltaViews = curr.viewsCount - prev.viewsCount;
    const deltaPercent = (deltaViews / prev.viewsCount) * 100;

    if (deltaPercent <= 300) continue;

    const priorRate = (interactionsOf(prev) / prev.viewsCount) * 100;
    const marginalRate =
      ((interactionsOf(curr) - interactionsOf(prev)) / deltaViews) * 100;
    const collapseThreshold = Math.min(
      VIEW_SPIKE_MARGINAL_FLOOR,
      priorRate * VIEW_SPIKE_COLLAPSE_RATIO
    );

    if (marginalRate >= collapseThreshold) continue;

    let severity: FraudFlagSeverity;
    if (deltaPercent > 5000) {
      severity = "CRITICAL";
    } else if (deltaPercent > 1000) {
      severity = "HIGH";
    } else {
      severity = "MEDIUM";
    }

    flags.push({
      flagType: "VIEW_SPIKE",
      severity,
      description: `Views increased by ${deltaPercent.toFixed(0)}% between snapshots (${prev.viewsCount} -> ${curr.viewsCount}) while the added views engaged at only ${marginalRate.toFixed(2)}% against a pre-spike rate of ${priorRate.toFixed(2)}%`,
      evidence: {
        viewsBefore: prev.viewsCount,
        viewsAfter: curr.viewsCount,
        deltaPercent: Math.round(deltaPercent),
        marginalEngagementRate: Math.round(marginalRate * 100) / 100,
        priorEngagementRate: Math.round(priorRate * 100) / 100,
        collapseThreshold: Math.round(collapseThreshold * 100) / 100,
        snapshotBeforeId: prev.id,
        snapshotAfterId: curr.id,
        snapshotBeforeAt: new Date(prev.recordedAt).toISOString(),
        snapshotAfterAt: new Date(curr.recordedAt).toISOString(),
      },
    });
  }

  // Rule 2: LOW_ENGAGEMENT — views > 10000 but engagement rate < 0.5%
  if (post.viewsCount > 10000) {
    const engagementRate =
      post.viewsCount > 0
        ? ((post.likesCount + post.commentsCount + post.sharesCount) /
            post.viewsCount) *
          100
        : 0;

    if (engagementRate < 0.5) {
      let severity: FraudFlagSeverity;
      if (engagementRate < 0.1) {
        severity = "HIGH";
      } else {
        severity = "LOW";
      }

      flags.push({
        flagType: "LOW_ENGAGEMENT",
        severity,
        description: `Post has ${post.viewsCount} views but only ${engagementRate.toFixed(2)}% engagement rate`,
        evidence: {
          viewsCount: post.viewsCount,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          sharesCount: post.sharesCount,
          engagementRate: Math.round(engagementRate * 100) / 100,
          expectedRate: 0.5,
        },
      });
    }
  }

  // Rule 3: BOT_PATTERN — high views but likes+comments ratio < 0.1%
  if (post.viewsCount > 50000) {
    const interactionRate =
      ((post.likesCount + post.commentsCount) / post.viewsCount) * 100;

    if (interactionRate < 0.1) {
      let severity: FraudFlagSeverity;
      if (post.viewsCount > 100000) {
        severity = "CRITICAL";
      } else {
        severity = "HIGH";
      }

      flags.push({
        flagType: "BOT_PATTERN",
        severity,
        description: `Post has ${post.viewsCount} views but likes+comments interaction rate is only ${interactionRate.toFixed(3)}%`,
        evidence: {
          viewsCount: post.viewsCount,
          likesCount: post.likesCount,
          commentsCount: post.commentsCount,
          interactionRate: Math.round(interactionRate * 1000) / 1000,
          threshold: 0.1,
        },
      });
    }
  }

  return flags;
}

export function fraudFlagKey(
  postId: string,
  flagType: FraudFlagType,
  evidence: unknown
): string {
  const snapshotAfterId =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? String((evidence as { snapshotAfterId?: unknown }).snapshotAfterId ?? "")
      : "";
  return `${postId}:${flagType}:${snapshotAfterId}`;
}
