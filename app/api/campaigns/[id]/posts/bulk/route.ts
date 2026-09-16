import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { parsePostTracking } from "@/lib/trackers/granularity";
import { POST_TTL_MAX_DAYS, POST_TTL_MIN_DAYS, clampTtlDays } from "@/lib/sync/postTracking";
import {
  BULK_ACTIONS,
  MAX_BULK_ACTION_POSTS,
  bulkActionSummary,
  bulkUpdateData,
} from "@/lib/posts/bulkActions";
import { z } from "zod";

/**
 * One action, many posts.
 *
 * The tenancy rule is the whole design of this route. `postIds` comes from a
 * request body, so it is never trusted to name a post: the update's `where`
 * carries `campaignId` alongside the id list, and the campaign itself was
 * looked up by `orgId` from the session first. An id belonging to another
 * tenant therefore matches no row and is silently skipped rather than acted on
 * -- which is why the response reports `updated` against `requested` instead of
 * claiming success for the whole list.
 *
 * updateMany rather than a transaction of single updates: every action here
 * writes the same columns to every row, so there is nothing per-post to decide
 * and one statement is both faster and atomic on its own.
 */
const bulkSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  postIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_ACTION_POSTS),
  ttlDays: z.number().int().min(POST_TTL_MIN_DAYS).max(POST_TTL_MAX_DAYS).optional(),
  rejectionReason: z.string().max(1000).nullable().optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    /* One click here writes up to fifty rows, so it is gated on the same
       permission as the single-post actions it batches: campaigns:edit_own,
       which every seat that may approve or track one post already holds and a
       VIEWER does not. */
    const gate = await requirePermission(request, "campaigns:edit_own");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { action, postIds, ttlDays, rejectionReason } = parsed.data;
    /* De-duplicated because a caller sending the same id twice would otherwise
       make `requested` overstate the selection and turn a complete run into an
       apparent partial one. */
    const ids = [...new Set(postIds)];

    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });
    const defaults = parsePostTracking(org?.uiConfig ?? null);

    const now = new Date();
    const data = bulkUpdateData({
      action,
      ttlDays,
      rejectionReason,
      defaultTtlDays: defaults.defaultTtlDays,
      now,
    });

    const result = await db.post.updateMany({
      // campaignId is the tenant guard; see the note at the top of this file.
      where: { id: { in: ids }, campaignId },
      data,
    });

    const appliedTtl =
      action === "track" ? clampTtlDays(ttlDays ?? defaults.defaultTtlDays, defaults.defaultTtlDays) : undefined;

    return NextResponse.json({
      action,
      requested: ids.length,
      updated: result.count,
      ttlDays: appliedTtl,
      message: bulkActionSummary(action, result.count, appliedTtl),
    });
  } catch (error) {
    console.error("Failed to run bulk post action:", error);
    return NextResponse.json({ error: "Failed to run that action" }, { status: 500 });
  }
}
