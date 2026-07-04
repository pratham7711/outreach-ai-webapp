import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { sendMessage } from "@/lib/messaging/conversations";
import { z } from "zod";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, creatorUserId: session.creatorUserId },
    include: {
      org: { select: { id: true, name: true, brandName: true, logoUrl: true } },
      campaign: { select: { id: true, title: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.message.updateMany({
    where: { conversationId, senderType: { in: ["ORG", "AI_AGENT"] }, readAt: null },
    data: { readAt: new Date() },
  });

  const messages = await db.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      senderType: true,
      senderUserId: true,
      body: true,
      negotiationOfferId: true,
      readAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      org: {
        id: conversation.org.id,
        name: conversation.org.brandName ?? conversation.org.name,
        logoUrl: conversation.org.logoUrl,
      },
      campaign: conversation.campaign,
      lastMessageAt: conversation.lastMessageAt,
    },
    messages,
  });
}

const postSchema = z.object({ body: z.string().min(1).max(5000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await params;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, creatorUserId: session.creatorUserId },
    select: { id: true },
  });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const json = await request.json();
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const message = await sendMessage({
    conversationId,
    senderType: "CREATOR",
    senderUserId: session.creatorUserId,
    body: parsed.data.body,
  });

  return NextResponse.json({ message }, { status: 201 });
}
