import { db } from "@/lib/db";
import type { MessageSenderType } from "@/lib/generated/prisma/client";

export type GetOrCreateConversationInput = {
  orgId: string;
  creatorUserId: string;
  campaignId?: string | null;
};

export async function getOrCreateConversation({
  orgId,
  creatorUserId,
  campaignId,
}: GetOrCreateConversationInput) {
  const normalizedCampaignId = campaignId ?? null;

  const existing = await db.conversation.findFirst({
    where: { orgId, creatorUserId, campaignId: normalizedCampaignId },
  });
  if (existing) return existing;

  return db.conversation.create({
    data: { orgId, creatorUserId, campaignId: normalizedCampaignId },
  });
}

export type SendMessageInput = {
  conversationId: string;
  senderType: MessageSenderType;
  senderUserId?: string | null;
  body: string;
  negotiationOfferId?: string | null;
};

export async function sendMessage({
  conversationId,
  senderType,
  senderUserId,
  body,
  negotiationOfferId,
}: SendMessageInput) {
  const now = new Date();

  const [message] = await db.$transaction([
    db.message.create({
      data: {
        conversationId,
        senderType,
        senderUserId: senderUserId ?? null,
        body,
        negotiationOfferId: negotiationOfferId ?? null,
        createdAt: now,
      },
    }),
    db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    }),
  ]);

  return message;
}

export async function resolveCreatorUserForCreator(orgId: string, creatorId: string) {
  const creator = await db.creator.findFirst({
    where: { id: creatorId, orgId },
    select: { handle: true },
  });
  if (!creator) return null;

  const handle = creator.handle;
  const bare = handle.replace(/^@/, "");

  const creatorUser = await db.creatorUser.findFirst({
    where: {
      OR: [{ handle }, { handle: `@${bare}` }, { handle: bare }],
    },
    select: { id: true, name: true, handle: true, avatarUrl: true },
  });

  return creatorUser;
}
