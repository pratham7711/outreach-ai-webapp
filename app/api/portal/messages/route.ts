import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversations = await db.conversation.findMany({
    where: { creatorUserId: session.creatorUserId },
    include: {
      org: { select: { id: true, name: true, brandName: true, logoUrl: true } },
      campaign: { select: { id: true, title: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, senderType: true, createdAt: true },
      },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  });

  const conversationIds = conversations.map((c) => c.id);
  const unreadGroups = conversationIds.length
    ? await db.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          senderType: { in: ["ORG", "AI_AGENT"] },
          readAt: null,
        },
        _count: { _all: true },
      })
    : [];
  const unreadMap = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

  const payload = conversations.map((c) => ({
    id: c.id,
    org: { id: c.org.id, name: c.org.brandName ?? c.org.name, logoUrl: c.org.logoUrl },
    campaign: c.campaign,
    lastMessageAt: c.lastMessageAt,
    lastMessage: c.messages[0] ?? null,
    unreadCount: unreadMap.get(c.id) ?? 0,
  }));

  return NextResponse.json({ conversations: payload });
}
