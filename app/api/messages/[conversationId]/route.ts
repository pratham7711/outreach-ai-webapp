import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { sendMessage } from "@/lib/messaging/conversations";
import { z } from "zod";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { conversationId } = await params;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, orgId },
    include: {
      creatorUser: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      campaign: { select: { id: true, title: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.message.updateMany({
    where: { conversationId, senderType: "CREATOR", readAt: null },
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
      creatorUser: conversation.creatorUser,
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
  const result = await authenticateRequest(request);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId } = result;
  const { conversationId } = await params;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, orgId },
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
    senderType: "ORG",
    senderUserId: userId,
    body: parsed.data.body,
  });

  return NextResponse.json({ message }, { status: 201 });
}
