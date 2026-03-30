import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

// GET /api/portal/dashboard — Creator dashboard summary
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const creatorUserId = session.creatorUserId;

    const [
      user,
      totalProposals,
      pendingProposals,
      acceptedProposals,
      recentProposals,
    ] = await Promise.all([
      db.creatorUser.findUnique({
        where: { id: creatorUserId },
        select: {
          name: true,
          handle: true,
          avatarUrl: true,
          lifetimeEarnings: true,
          averageRating: true,
          reviewCount: true,
          cpm: true,
        },
      }),
      db.campaignProposal.count({ where: { creatorUserId } }),
      db.campaignProposal.count({ where: { creatorUserId, status: "PENDING" } }),
      db.campaignProposal.count({ where: { creatorUserId, status: "ACCEPTED" } }),
      db.campaignProposal.findMany({
        where: { creatorUserId },
        include: {
          campaign: { select: { id: true, title: true, budget: true, currency: true, org: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return NextResponse.json({
      user,
      stats: {
        totalProposals,
        pendingProposals,
        acceptedProposals,
        lifetimeEarnings: user?.lifetimeEarnings ?? 0,
      },
      recentProposals,
    });
  } catch (error) {
    console.error("Failed to fetch creator dashboard:", error);
    return NextResponse.json({ error: "Failed to fetch dashboard" }, { status: 500 });
  }
}
