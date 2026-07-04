import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { getOrCreateConversation, appendMessage } from "@/lib/negotiation/conversation";
import { z } from "zod";

const startBatchSchema = z.object({
  campaignId: z.string().min(1),
  creatorIds: z.array(z.string().min(1)).min(1),
  offeredRate: z.number().positive(),
  currency: z.string().default("USD"),
});

function formatRate(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

// POST /api/negotiations/start-batch — org sends an offer to each selected creator
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId as string;

    const body = await request.json();
    const parsed = startBatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { campaignId, creatorIds, offeredRate, currency } = parsed.data;

    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const uniqueCreatorIds = Array.from(new Set(creatorIds));
    const creators = await db.creator.findMany({
      where: { id: { in: uniqueCreatorIds }, orgId, deletedAt: null },
      select: { id: true, name: true, handle: true },
    });
    const creatorById = new Map(creators.map((c) => [c.id, c]));

    const results: Array<{
      creatorId: string;
      offerId: string | null;
      onPortal: boolean;
      status: string;
    }> = [];

    for (const creatorId of uniqueCreatorIds) {
      const creator = creatorById.get(creatorId);
      if (!creator) {
        results.push({ creatorId, offerId: null, onPortal: false, status: "creator not found" });
        continue;
      }

      const offer = await db.negotiationOffer.create({
        data: {
          campaignId,
          orgId,
          creatorId,
          offeredRate,
          currency,
          status: "PENDING",
          aiRound: 0,
        },
      });

      const bareHandle = creator.handle.replace(/^@/, "");
      const creatorUser = await db.creatorUser.findFirst({
        where: {
          OR: [
            { handle: creator.handle },
            { handle: `@${bareHandle}` },
            { handle: bareHandle },
          ],
        },
        select: { id: true },
      });

      let onPortal = false;
      if (creatorUser) {
        const conversationId = await getOrCreateConversation({
          orgId,
          creatorUserId: creatorUser.id,
          campaignId,
        });
        await db.negotiationOffer.update({
          where: { id: offer.id },
          data: { conversationId },
        });
        await appendMessage({
          conversationId,
          senderType: "ORG",
          body: `We'd love to work with you on "${campaign.title}". Our offer is ${formatRate(offeredRate, currency)}. Let us know if that works, or send us your rate.`,
          negotiationOfferId: offer.id,
          senderUserId: session.user.id ?? null,
        });
        onPortal = true;
      }

      results.push({
        creatorId,
        offerId: offer.id,
        onPortal,
        status: onPortal ? "sent" : "not on portal",
      });
    }

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "negotiation.start_batch",
      entityType: "Campaign",
      entityId: campaignId,
      entityLabel: `Batch offer ${formatRate(offeredRate, currency)} to ${results.length} creators`,
      ipAddress: getRequestIp(request),
      after: { offeredRate, currency, count: results.length },
    });

    return NextResponse.json({ campaignId, offeredRate, currency, results }, { status: 201 });
  } catch (error) {
    console.error("Failed to start negotiation batch:", error);
    return NextResponse.json({ error: "Failed to start negotiation batch" }, { status: 500 });
  }
}
