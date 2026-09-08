import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import type { CampaignStatus, Prisma } from "@/lib/generated/prisma/client";
import { createLogger } from "@/lib/observability/logger";

/* Reasons a candidate is not approved. "fraud-flag" and "not-marketplace" are
   no longer produced here -- both are filters on the read now -- but they stay
   in the union because they are what a reader of a stored decision will meet. */
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
  reason: "auto-approve" | "too-recent" | Skip;
};

// Campaign statuses that stop auto-approval (paused / finished / cancelled).
const STOPPED_STATUSES: CampaignStatus[] = ["COMPLETE", "CANCELLED"];

const HOUR_MS = 60 * 60 * 1000;

/* Vercel's default function ceiling is well under what a page of approvals
   takes -- each one is an update, an accrual recompute and an audit write -- and
   an undeclared ceiling cut the run off mid-page with no record of where. */
export const maxDuration = 300;

/** Rows per read. Small enough that a page is cheap, large enough that a
 *  backlog of a few thousand is a handful of round trips. */
const PAGE_SIZE = 200;
/** Hard ceiling on rows examined in one run, so a pathological backlog cannot
 *  spin the function to its own timeout. The deadline below usually bites
 *  first; this is the backstop. */
const MAX_CONSIDERED = 5000;

/**
 * One page of candidates, oldest first.
 *
 * Extracted from the loop only so that `cursor` and the row type do not infer
 * through each other -- the page's last id feeds the next call's cursor, and
 * inline that is a circular initializer TypeScript refuses to resolve.
 */
function readCandidatePage(
  where: Prisma.PostWhereInput,
  after: { createdAt: Date; id: string } | null
) {
  return db.post.findMany({
    /* Keyset, not Prisma's `cursor`. A cursor is an id that must still be in
       the filtered set to locate the page, and approving a post takes it out of
       that set -- so the last row of one page is routinely gone by the time the
       next page asks to resume from it, which silently truncates the sweep.
       Comparing on the sort key instead needs no surviving row. */
    where: after
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            },
          ],
        }
      : where,
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
    /* id breaks createdAt ties, so the keyset above can neither skip nor repeat
       a row when several submissions share a timestamp. */
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE,
  });
}

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
  const log = createLogger({ context: { route: "cron/auto-approve-submissions" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const nowMs = now.getTime();
  /* Leave a minute of the declared ceiling for the response and for whatever
     write is in flight when the clock runs out. */
  const deadline = Date.now() + 4 * 60 * 1000;

  let approved = 0;
  let skipped = 0;
  let failed = 0;
  let campaignsCompleted = 0;
  let considered = 0;
  let timedOut = false;
  const decisions: Decision[] = [];

  try {
    /* Candidate posts: pending review on marketplace campaigns (not PRIVATE).
     *
     * The three PERMANENT gates -- stopped campaign, passed deadline, open
     * fraud flag -- are filters here rather than `continue`s in the loop, and
     * that is the whole point of this query.
     *
     * It used to be one `take: 500` ordered createdAt asc, with every gate
     * applied afterwards. None of those three ever clears on its own: a
     * cancelled campaign stays cancelled, a deadline stays passed, an
     * unresolved flag stays unresolved, and the post stays PENDING_REVIEW
     * either way. So gated rows accumulate at the head of a createdAt-ordered
     * read, and once 500 of them exist the window is full of rows that can
     * never be approved -- every genuinely eligible submission behind them is
     * silently never reached, on every run, forever. Filtering in SQL means a
     * permanently gated row is not a candidate at all.
     *
     * The two gates that are NOT expressible stay in the loop: "too recent"
     * depends on the campaign's own autoApproveHours and clears with time
     * anyway, and the budget cap is computed. Those cannot starve the read the
     * same way -- a too-recent row becomes eligible, and a capped campaign is
     * marked COMPLETE below, which the status filter then excludes.
     *
     * Read in pages until the work is done or the clock runs out, so the bound
     * on a run is time rather than an arbitrary row count. */
    /* No open fraud flag. ViewFraudFlag carries postId as a plain column with no
       relation back to Post (the `fraudFlags` relation lives on Campaign), so
       this cannot be a relation filter -- the 2026-09-08 06:00Z run 500ed on
       `fraudFlags: { none: ... }`, which type-checked only because `where` was
       an untyped object literal. Open flags are rare and never clear on their
       own, so one distinct read of their post ids is the whole gate. */
    const flagged = await db.viewFraudFlag.findMany({
      where: { isResolved: false },
      select: { postId: true },
      distinct: ["postId"],
    });
    const flaggedPostIds = flagged.map((f) => f.postId);
    const where: Prisma.PostWhereInput = {
      status: "PENDING_REVIEW",
      ...(flaggedPostIds.length ? { id: { notIn: flaggedPostIds } } : {}),
      campaign: {
        deletedAt: null,
        marketplaceVisibility: { not: "PRIVATE" },
        status: { notIn: STOPPED_STATUSES },
        OR: [{ submissionDeadline: null }, { submissionDeadline: { gte: now } }],
      },
    };

    // Cache per-campaign accrual so we don't recompute for every post, and so a
    // batch of approvals in one run respects the cap as it fills up.
    const accrualCache = new Map<
      string,
      { accruedMinor: number; capMinor: number | null }
    >();
    /* Campaigns already completed by this run. Without it a campaign with
       thirty posts over its cap issued thirty identical campaign.update calls
       and counted thirty completions -- the in-loop `c.status` mutation only
       ever touched one post's own copy of the campaign. */
    const completedCampaigns = new Set<string>();

    let after: { createdAt: Date; id: string } | null = null;
    let exhausted = false;

    pages: while (!exhausted && considered < MAX_CONSIDERED) {
      if (Date.now() > deadline) {
        timedOut = true;
        break;
      }

      const posts = await readCandidatePage(where, after);

      if (posts.length === 0) break;
      if (posts.length < PAGE_SIZE) exhausted = true;
      const last = posts[posts.length - 1];
      after = { createdAt: last.createdAt, id: last.id };
      considered += posts.length;

      for (const post of posts) {
        /* Checked per post, not per page: one page of approvals is 200 updates
           plus their accrual recomputes and audit writes, which is minutes, and
           a run cut off by the platform mid-page leaves no record of where it
           got to. */
        if (Date.now() > deadline) {
          timedOut = true;
          break pages;
        }

        const c = post.campaign;

        /* The three filtered gates are re-checked here as a backstop, not as the
           mechanism: the query above is what stops them starving the read, and
           these only catch a where-clause and loop that have drifted apart. */
        if (STOPPED_STATUSES.includes(c.status) || completedCampaigns.has(c.id)) {
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
          if (!dryRun) {
            await markCampaignCapped(c.id, c.orgId, c.title);
            completedCampaigns.add(c.id);
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
          if (
            rateAccrual.capReached &&
            !STOPPED_STATUSES.includes(c.status) &&
            !completedCampaigns.has(c.id)
          ) {
            await markCampaignCapped(c.id, c.orgId, c.title);
            completedCampaigns.add(c.id);
            c.status = "COMPLETE";
            campaignsCompleted++;
          }
        } catch (err) {
          log.error("failed to auto-approve post", { postId: post.id, error: String(err) });
          failed++;
        }
      }
    }

    log.info("auto-approve sweep complete", {
      considered,
      approved,
      skipped,
      failed,
      campaignsCompleted,
      /* The one line that says a backlog outlived the run, which is the state
         the old single-page read could not distinguish from "all done". */
      timedOut,
      dryRun,
    });

    if (dryRun) {
      const byReason: Record<string, number> = {};
      for (const d of decisions) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      return NextResponse.json({
        ok: true,
        dryRun: true,
        total: considered,
        timedOut,
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
      timedOut,
      total: considered,
    });
  } catch (error) {
    log.error("cron run failed", { error: String(error) });
    return NextResponse.json({ error: "Auto-approve failed" }, { status: 500 });
  }
}

/** Mark a campaign COMPLETE because it reached its marketplace budget cap. */
async function markCampaignCapped(campaignId: string, orgId: string, title: string) {
  const log = createLogger({ context: { route: "cron/auto-approve-submissions" } });
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
    log.error("failed to complete capped campaign", { campaignId, error: String(err) });
  }
}
