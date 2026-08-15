import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";
import { httpUrl } from "@/lib/validation/url";

// Statuses from which a creator may (re)submit a draft for approval.
const SUBMITTABLE = ["AWAITING_DRAFT", "DECLINED", "DRAFT_SUBMITTED"];

const draftSchema = z.object({
  draftUrl: httpUrl(),
  draftCaption: z.string().max(2200).optional(),
  draftMediaType: z.enum(["REEL", "STORY", "POST", "SHORT", "VIDEO"]).optional(),
});

// POST /api/portal/campaigns/[slug]/draft — creator submits draft content for approval.
// Pre-publish: a link to the proposed content + caption. Distinct from /submissions,
// which registers an already-public post for metrics tracking.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { slug } = await params;
    const body = await request.json();
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { draftUrl, draftCaption, draftMediaType } = parsed.data;

    const campaign = await db.campaign.findUnique({
      where: { publicSlug: slug },
      select: { id: true, orgId: true, deletedAt: true, submissionDeadline: true },
    });
    if (!campaign || campaign.deletedAt) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    if (campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now()) {
      return NextResponse.json({ error: "The submission deadline has passed" }, { status: 409 });
    }

    // Must be joined — resolve creator + activation (never trust client orgId).
    const creator = await db.creator.findFirst({
      where: { orgId: campaign.orgId, handle: session.handle, deletedAt: null },
      select: { id: true },
    });
    const activation = creator
      ? await db.activation.findFirst({
          where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
          select: { id: true, status: true },
        })
      : null;
    if (!creator || !activation) {
      return NextResponse.json({ error: "You must join this campaign before submitting a draft" }, { status: 403 });
    }

    if (!SUBMITTABLE.includes(activation.status)) {
      return NextResponse.json(
        { error: `Your draft can no longer be changed (status: ${activation.status})` },
        { status: 409 }
      );
    }

    const updated = await db.activation.update({
      where: { id: activation.id },
      data: {
        status: "DRAFT_SUBMITTED",
        draftUrl,
        draftCaption: draftCaption ?? null,
        draftMediaType: draftMediaType ?? null,
        draftSubmittedAt: new Date(),
        feedbackNotes: null,
      },
      select: {
        id: true,
        status: true,
        draftUrl: true,
        draftCaption: true,
        draftMediaType: true,
        draftSubmittedAt: true,
      },
    });

    return NextResponse.json(updated, { status: 201 });
  } catch (error) {
    console.error("Failed to submit draft:", error);
    return NextResponse.json({ error: "Failed to submit draft" }, { status: 500 });
  }
}
