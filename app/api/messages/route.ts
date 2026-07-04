import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import {
  getOrCreateConversation,
  sendMessage,
  resolveCreatorUserForCreator,
} from "@/lib/messaging/conversations";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const conversations = await db.conversation.findMany({
    where: { orgId },
    include: {
      creatorUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
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
          senderType: "CREATOR",
          readAt: null,
        },
        _count: { _all: true },
      })
    : [];
  const unreadMap = new Map(unreadGroups.map((g) => [g.conversationId, g._count._all]));

  const payload = conversations.map((c) => ({
    id: c.id,
    creatorUser: c.creatorUser,
    campaign: c.campaign,
    lastMessageAt: c.lastMessageAt,
    lastMessage: c.messages[0] ?? null,
    unreadCount: unreadMap.get(c.id) ?? 0,
  }));

  return NextResponse.json({ conversations: payload });
}

const postSchema = z.object({
  creatorId: z.string().min(1),
  campaignId: z.string().min(1).nullable().optional(),
  body: z.string().min(1).max(5000),
});

export async function POST(request: NextRequest) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId } = result;

  const json = await request.json();
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { creatorId, campaignId, body } = parsed.data;

  const creatorUser = await resolveCreatorUserForCreator(orgId, creatorId);
  if (!creatorUser) {
    return NextResponse.json({ error: "Creator hasn't joined the portal" }, { status: 404 });
  }

  const conversation = await getOrCreateConversation({
    orgId,
    creatorUserId: creatorUser.id,
    campaignId: campaignId ?? null,
  });

  await sendMessage({
    conversationId: conversation.id,
    senderType: "ORG",
    senderUserId: userId,
    body,
  });

  return NextResponse.json({ conversationId: conversation.id }, { status: 201 });
}
