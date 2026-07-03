import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import type { WebhookEvent } from "./types";

export interface RecordWebhookResult {
  alreadyProcessed: boolean;
  id: string;
}

export async function recordWebhookEvent(event: WebhookEvent): Promise<RecordWebhookResult> {
  const existing = await db.paymentWebhookEvent.findUnique({
    where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
  });

  if (existing) {
    return { alreadyProcessed: existing.processedAt !== null, id: existing.id };
  }

  try {
    const created = await db.paymentWebhookEvent.create({
      data: {
        provider: event.provider,
        eventId: event.eventId,
        type: event.type,
        payloadJson: event.payload as unknown as Prisma.InputJsonValue,
        signatureValid: event.signatureValid,
      },
    });
    return { alreadyProcessed: false, id: created.id };
  } catch {
    const stored = await db.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: event.provider, eventId: event.eventId } },
    });
    if (stored) {
      return { alreadyProcessed: stored.processedAt !== null, id: stored.id };
    }
    throw new Error("Failed to record webhook event");
  }
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await db.paymentWebhookEvent.update({
    where: { id },
    data: { processedAt: new Date() },
  });
}
