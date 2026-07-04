import { db } from "@/lib/db";
import type { MessageSenderType } from "@/lib/generated/prisma/client";

export async function getOrCreateConversation(params: {
  orgId: string;
  creatorUserId: string;
  campaignId: string;
}): Promise<string> {
  const { orgId, creatorUserId, campaignId } = params;
  const existing = await db.conversation.findFirst({
    where: { orgId, creatorUserId, campaignId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.conversation.create({
    data: { orgId, creatorUserId, campaignId, lastMessageAt: new Date() },
    select: { id: true },
  });
  return created.id;
}

export async function appendMessage(params: {
  conversationId: string;
  senderType: MessageSenderType;
  body: string;
  negotiationOfferId?: string | null;
  senderUserId?: string | null;
}): Promise<void> {
  const { conversationId, senderType, body, negotiationOfferId, senderUserId } = params;
  const now = new Date();
  await db.message.create({
    data: {
      conversationId,
      senderType,
      body,
      negotiationOfferId: negotiationOfferId ?? null,
      senderUserId: senderUserId ?? null,
    },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: now },
  });
}
