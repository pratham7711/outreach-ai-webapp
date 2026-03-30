import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";

const createTestimonialSchema = z.object({
  orgId: z.string().min(1),
  campaignId: z.string().min(1),
  content: z.string().min(10).max(1000),
});

// GET /api/portal/testimonials — List my testimonials
export async function GET(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const creatorUserId = session.creatorUserId;

    const testimonials = await db.creatorTestimonial.findMany({
      where: { creatorUserId },
      include: {
        org: { select: { id: true, name: true } },
        campaign: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ testimonials });
  } catch (error) {
    console.error("Failed to fetch testimonials:", error);
    return NextResponse.json({ error: "Failed to fetch testimonials" }, { status: 500 });
  }
}

// POST /api/portal/testimonials — Submit a testimonial for an org/campaign
export async function POST(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const creatorUserId = session.creatorUserId;

    const body = await request.json();
    const parsed = createTestimonialSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { orgId, campaignId, content } = parsed.data;

    // Check for duplicate testimonial on this campaign
    const existing = await db.creatorTestimonial.findFirst({
      where: { creatorUserId, campaignId },
    });
    if (existing) {
      return NextResponse.json({ error: "You already submitted a testimonial for this campaign" }, { status: 409 });
    }

    // Verify the creator had an accepted proposal for this campaign
    const acceptedProposal = await db.campaignProposal.findFirst({
      where: { creatorUserId, campaignId, status: "ACCEPTED" },
    });
    if (!acceptedProposal) {
      return NextResponse.json({ error: "You must have an accepted proposal for this campaign" }, { status: 403 });
    }

    const testimonial = await db.creatorTestimonial.create({
      data: { creatorUserId, orgId, campaignId, content },
    });

    return NextResponse.json({ testimonial }, { status: 201 });
  } catch (error) {
    console.error("Failed to create testimonial:", error);
    return NextResponse.json({ error: "Failed to create testimonial" }, { status: 500 });
  }
}
