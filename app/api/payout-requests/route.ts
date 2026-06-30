import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";

// ---------- GET /api/payout-requests ----------
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = authResult.orgId;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");

    const where: any = { orgId };
    if (
      statusFilter &&
      ["PENDING", "APPROVED", "REJECTED"].includes(statusFilter)
    ) {
      where.status = statusFilter;
    }

    const requests = await db.payoutRequest.findMany({
      where,
      include: {
        campaign: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Collect unique creator IDs to fetch names
    const creatorIds = [...new Set(requests.map((r: any) => r.creatorId))];
    const creators =
      creatorIds.length > 0
        ? await db.creator.findMany({
            where: { id: { in: creatorIds } },
            select: { id: true, name: true, handle: true },
          })
        : [];

    const creatorMap: Record<string, { name: string; handle: string | null }> =
      {};
    for (const c of creators) {
      creatorMap[c.id] = { name: c.name, handle: c.handle };
    }

    const result = requests.map((r: any) => ({
      id: r.id,
      campaignId: r.campaignId,
      campaignTitle: r.campaign?.title ?? null,
      creatorId: r.creatorId,
      creatorName: creatorMap[r.creatorId]?.name ?? null,
      creatorHandle: creatorMap[r.creatorId]?.handle ?? null,
      requestedAmount: r.requestedAmount,
      currency: r.currency,
      status: r.status,
      rejectionReason: r.rejectionReason,
      processedAt: r.processedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ payoutRequests: result });
  } catch (error) {
    console.error("Failed to fetch payout requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch payout requests" },
      { status: 500 }
    );
  }
}
