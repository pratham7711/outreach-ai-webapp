import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import type { CampaignStatus } from "@/lib/generated/prisma/client";

type Skip =
  | "not-marketplace"
  | "campaign-paused"
  | "deadline-passed"
  | "cap-reached"
  | "fraud-flag";

type Decision = {
  postId: string;
  campaignId: string;
  action: "approve" | "skip";
  reason: string; // "auto-approve" | Skip | "too-recent"
};

// Campaign statuses that stop auto-approval (paused / finished / cancelled).
const STOPPED_STATUSES: CampaignStatus[] = ["COMPLETE", "CANCELLED"];

const HOUR_MS = 60 * 60 * 1000;

/**
 * GET /api/cron/auto-approve-submissions
 *
 * Auto-approves marketplace submissions (Post.status = PENDING_REVIEW) whose
 * age exceeds their campaign's `autoApproveHours`, unless the post/campaign is
 * gated (fraud flag, past deadline, paused/finished campaign, or the campaign
 * has hit its marketplace budget cap).
 *
 * Auth + ?dryRun=1 report shape mirror /api/cron/sync-posts exactly
 * (fail-closed on missing/wrong CRON_SECRET).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const nowMs = now.getTime();

  let approved = 0;
  let skipped = 0;
  let failed = 0;
  let campaignsCompleted = 0;
  const decisions: Decision[] = [];

  try {
    // Candidate posts: pending review on marketplace campaigns (not PRIVATE),
    // pull only the campaign fields the gates need.
    const posts = await db.post.findMany({
      where: {
        status: "PENDING_REVIEW",
        campaign: {
          deletedAt: null,
          marketplaceVisibility: { not: "PRIVATE" },
        },
      },
      select: {
        id: true,
        createdAt: true,
        campaignId: true,
        campaign: {
          select: {
            id: true,
            orgId: true,
            title: true,
            status: true,
            autoApproveHours: true,
            submissionDeadline: true,
            marketplaceVisibility: true,
            ratePerThousand: true,
            marketplaceBudgetCapMinor: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    // Cache per-campaign accrual so we don't recompute for every post, and so a
    // batch of approvals in one run respects the cap as it fills up.
    const accrualCache = new Map<
      string,
      { accruedMinor: number; capMinor: number | null }
    >();

    for (const post of posts) {
      const c = post.campaign;

      // Gate: campaign paused / completed / cancelled.
      if (STOPPED_STATUSES.includes(c.status)) {
        decisions.push({ postId: post.id, campaignId: c.id, action: "skip", reason: "campaign-paused" });
        skipped++;
        continue;
      }

      // Gate: submission deadline passed.
      if (c.submissionDeadline && c.submissionDeadline.getTime() < nowMs) {
        decisions.push({ postId: post.id, campaignId: c.id, action: "skip", reason: "deadline-passed" });
        skipped++;
        continue;
      }

      // Gate: not old enough yet.
      const ageMs = nowMs - post.createdAt.getTime();
      const thresholdMs = (c.autoApproveHours ?? 48) * HOUR_MS;
      if (ageMs < thresholdMs) {
        decisions.push({ postId: post.id, campaignId: c.id, action: "skip", reason: "too-recent" });
        skipped++;
        continue;
      }

      // Gate: any unresolved fraud flag on this post.
      const openFlag = await db.viewFraudFlag.findFirst({
        where: { postId: post.id, isResolved: false },
        select: { id: true },
      });
      if (openFlag) {
        decisions.push({ postId: post.id, campaignId: c.id, action: "skip", reason: "fraud-flag" });
        skipped++;
        continue;
      }

      // Gate: campaign already at/over its marketplace budget cap.
      let cached = accrualCache.get(c.id);
      if (!cached) {
        const accrual = await computeCampaignAccrual(c.id, {
          ratePerThousand: c.ratePerThousand,
          marketplaceBudgetCapMinor: c.marketplaceBudgetCapMinor,
        });
        cached = { accruedMinor: accrual.accruedMinor, capMinor: accrual.capMinor };
        accrualCache.set(c.id, cached);
      }
      if (cached.capMinor != null && cached.capMinor > 0 && cached.accruedMinor >= cached.capMinor) {
        decisions.push({ postId: post.id, campaignId: c.id, action: "skip", reason: "cap-reached" });
        skipped++;
        // Ensure the campaign is marked COMPLETE once cap is reached.
        if (!dryRun && !STOPPED_STATUSES.includes(c.status)) {
          await markCampaignCapped(c.id, c.orgId, c.title);
          c.status = "COMPLETE";
          campaignsCompleted++;
        }
        continue;
      }

      decisions.push({ postId: post.id, campaignId: c.id, action: "approve", reason: "auto-approve" });

      if (dryRun) continue;

      try {
        await db.post.update({
          where: { id: post.id },
          data: { status: "APPROVED", rejectionReason: null },
        });
        approved++;

        // Reflect this approval in the cached accrual so subsequent posts in
        // the same run respect the cap.
        const rateAccrual = await computeCampaignAccrual(c.id, {
          ratePerThousand: c.ratePerThousand,
          marketplaceBudgetCapMinor: c.marketplaceBudgetCapMinor,
        });
        accrualCache.set(c.id, {
          accruedMinor: rateAccrual.accruedMinor,
          capMinor: rateAccrual.capMinor,
        });

        await logAudit({
          orgId: c.orgId,
          actorType: "system:auto-approve",
          action: "post.auto_approved",
          entityType: "Post",
          entityId: post.id,
          entityLabel: c.title,
          metadata: { campaignId: c.id, ageHours: Math.round(ageMs / HOUR_MS) },
          before: { status: "PENDING_REVIEW" },
          after: { status: "APPROVED" },
        });

        // If this approval tipped the campaign over its cap, complete it.
        if (rateAccrual.capReached && !STOPPED_STATUSES.includes(c.status)) {
          await markCampaignCapped(c.id, c.orgId, c.title);
          c.status = "COMPLETE";
          campaignsCompleted++;
        }
      } catch (err) {
        console.error(`Failed to auto-approve post ${post.id}:`, err);
        failed++;
      }
    }

    if (dryRun) {
      const byReason: Record<string, number> = {};
      for (const d of decisions) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      return NextResponse.json({
        ok: true,
        dryRun: true,
        total: posts.length,
        wouldApprove: decisions.filter((d) => d.action === "approve").length,
        wouldSkip: decisions.filter((d) => d.action === "skip").length,
        summary: { byReason },
        decisions,
      });
    }

    return NextResponse.json({
      ok: true,
      approved,
      skipped,
      failed,
      campaignsCompleted,
      total: posts.length,
    });
  } catch (error) {
    console.error("Cron auto-approve-submissions failed:", error);
    return NextResponse.json({ error: "Auto-approve failed" }, { status: 500 });
  }
}

/** Mark a campaign COMPLETE because it reached its marketplace budget cap. */
async function markCampaignCapped(campaignId: string, orgId: string, title: string) {
  try {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "COMPLETE" },
    });
    await logAudit({
      orgId,
      actorType: "system:auto-approve",
      action: "campaign.marketplace_cap_reached",
      entityType: "Campaign",
      entityId: campaignId,
      entityLabel: title,
      metadata: { reason: "marketplace_budget_cap" },
      after: { status: "COMPLETE" },
    });
  } catch (err) {
    console.error(`Failed to complete capped campaign ${campaignId}:`, err);
  }
}
