import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { joinCampaignBySlug } from "@/lib/marketplace/join";
import { z } from "zod";

const joinSchema = z.object({
  slug: z.string().min(1),
  inviteCode: z.string().min(1).max(64).optional(),
});

// POST /api/portal/campaigns/join — join a marketplace campaign by public slug
export async function POST(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await joinCampaignBySlug(session, parsed.data.slug, parsed.data.inviteCode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        activationId: result.activationId,
        campaignSlug: result.campaignSlug,
        alreadyJoined: result.alreadyJoined,
      },
      { status: result.alreadyJoined ? 200 : 201 }
    );
  } catch (error) {
    console.error("Failed to join campaign:", error);
    return NextResponse.json({ error: "Failed to join campaign" }, { status: 500 });
  }
}
