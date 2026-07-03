import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";

export function hashRequest(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? null))
    .digest("hex");
}

export async function withIdempotency<T>(
  key: string,
  orgId: string,
  purpose: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new Error("idempotency key is required");
  }

  const requestHash = hashRequest(args);
  const existing = await db.paymentIdempotencyKey.findUnique({ where: { key } });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new Error(
        `Idempotency key "${key}" was reused with different request arguments`,
      );
    }
    return existing.responseJson as T;
  }

  const result = await fn();

  try {
    await db.paymentIdempotencyKey.create({
      data: {
        key,
        orgId,
        purpose,
        requestHash,
        responseJson: result as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    const stored = await db.paymentIdempotencyKey.findUnique({ where: { key } });
    if (stored) {
      if (stored.requestHash !== requestHash) {
        throw new Error(
          `Idempotency key "${key}" was reused with different request arguments`,
        );
      }
      return stored.responseJson as T;
    }
    throw new Error(`Failed to persist idempotency key "${key}"`);
  }

  return result;
}
