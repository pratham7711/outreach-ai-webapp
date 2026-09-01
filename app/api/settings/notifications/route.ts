import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { NOTIFICATION_EVENTS, resolvePrefs } from "@/lib/notifications";

/**
 * The signed-in user's own email-notification preferences — the reference's
 * "My Settings → Notifications". Per-user by design, so there is no permission
 * gate beyond a session: everyone may decide what lands in their own inbox.
 *
 * Stored sparsely (only the keys the user has touched); the catalog's defaults
 * fill the rest at read time, so shipping a new event with a sane default
 * needs no backfill.
 */

const BodySchema = z.record(z.string(), z.boolean());

const KNOWN_KEYS = new Set(NOTIFICATION_EVENTS.map((e) => e.key));

async function requireUser() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId };
}

export async function GET() {
  const auth_ = await requireUser();
  if ("error" in auth_) return auth_.error;

  const user = await db.user.findUnique({
    where: { id: auth_.userId },
    select: { notificationPrefs: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    prefs: resolvePrefs(user.notificationPrefs),
    catalog: NOTIFICATION_EVENTS,
  });
}

export async function PATCH(request: NextRequest) {
  const auth_ = await requireUser();
  if ("error" in auth_) return auth_.error;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => KNOWN_KEYS.has(key))
  );
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No known notification keys in body" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: auth_.userId },
    select: { notificationPrefs: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const current =
    user.notificationPrefs && typeof user.notificationPrefs === "object" && !Array.isArray(user.notificationPrefs)
      ? (user.notificationPrefs as Record<string, unknown>)
      : {};

  const next = await db.user.update({
    where: { id: auth_.userId },
    data: { notificationPrefs: { ...current, ...updates } as Prisma.InputJsonValue },
    select: { notificationPrefs: true },
  });

  return NextResponse.json({
    prefs: resolvePrefs(next.notificationPrefs),
    catalog: NOTIFICATION_EVENTS,
  });
}
