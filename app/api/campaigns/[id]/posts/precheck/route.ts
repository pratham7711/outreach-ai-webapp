import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { campaignScopeWhere, scopeSubjectFromSession } from "@/lib/campaignScope";
import { httpUrl } from "@/lib/validation/url";
import { z } from "zod";
import { precheckPostUrl } from "@/lib/posts/addPostChecks";
import { MAX_BULK_POSTS } from "@/lib/posts/pastedUrls";
import { hasPermission } from "@/lib/rbac";

/* Reads only. It answers the questions the POST handler would have answered
   anyway -- is there a creator for this handle, is this post already on record
   -- but for a whole paste at once and before anything is written, so the
   dialog can mark the bad rows instead of discovering them mid-batch. */
const precheckSchema = z.object({
  urls: z.array(httpUrl()).min(1).max(MAX_BULK_POSTS),
});

// POST /api/campaigns/[id]/posts/precheck
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Same row scope as reading the campaign's posts: this reports which other
    // campaigns hold a post, so it must not answer for a campaign the seat
    // cannot open.
    const scope = scopeSubjectFromSession(session.user);
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null, ...(scope ? campaignScopeWhere(scope) : {}) },
      select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const parsed = precheckSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    /* Sequential would be fifty round trips for a fifty-link paste while the
       operator watches an empty dialog; these are short indexed reads with no
       writes between them, so they go together. */
    const mayCreateCreator = hasPermission((session.user as any).role ?? "", "creators:create");
    const results = await Promise.all(
      parsed.data.urls.map((url) => precheckPostUrl(orgId, campaignId, url, mayCreateCreator)),
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Failed to precheck post urls:", error);
    return NextResponse.json({ error: "Failed to check those links" }, { status: 500 });
  }
}
