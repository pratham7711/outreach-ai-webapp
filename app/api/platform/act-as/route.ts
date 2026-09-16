import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import {
  ACT_AS_COOKIE,
  ACT_AS_MAX_AGE_SECONDS,
  encodeActAs,
  parseActAs,
} from "@/lib/platform/actAs";
import { getRequestIp } from "@/lib/request";

/**
 * Opening, and closing, a tenant's workspace as the platform operator.
 *
 * The switch itself is applied in lib/auth.ts; this route only decides who may
 * ask for one and leaves the trail. Both halves matter: entering somebody
 * else's workspace is the single most sensitive thing this product can do, and
 * an operator who cannot say afterwards which org they opened, when, and
 * whether they could write, has no answer for a customer who asks.
 *
 * 404 rather than 403 for a non-operator, matching the sibling routes under
 * /api/platform: a 403 confirms the endpoint exists to somebody who should not
 * know it does.
 */

function forbidden() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

const StartSchema = z.object({
  orgId: z.string().min(1),
  /** No default. See the mode note in lib/platform/actAs. */
  mode: z.enum(["read", "full"]),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!session?.user || !isPlatformAdmin(email)) return forbidden();

  const parsed = StartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { orgId, mode } = parsed.data;

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* The operator's own org, read from the session BEFORE the switch takes
     effect on the next request, so the trail records where they came from. */
  const homeOrgId = (session.user as { orgId?: string }).orgId ?? null;

  await db.auditLog
    .create({
      data: {
        orgId: org.id,
        userId: (session.user as { id?: string }).id ?? null,
        action: "platform.act_as_started",
        entityType: "Organization",
        entityId: org.id,
        entityLabel: org.name,
        actorType: "platform",
        actorEmail: email,
        ipAddress: getRequestIp(request),
        metadata: { mode, fromOrgId: homeOrgId },
      },
    })
    .catch(() => {
      /* An audit write must not be the reason an operator cannot reach a
         customer's broken screen -- but see the note in DELETE: the trail is
         still written on the way out. */
    });

  const res = NextResponse.json({ org: { id: org.id, name: org.name }, mode });
  res.cookies.set(ACT_AS_COOKIE, encodeActAs(org.id, mode), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACT_AS_MAX_AGE_SECONDS,
  });
  return res;
}

/** Back to the operator's own workspace. */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!session?.user || !isPlatformAdmin(email)) return forbidden();

  const current = parseActAs(request.cookies.get(ACT_AS_COOKIE)?.value);
  if (current) {
    await db.auditLog
      .create({
        data: {
          orgId: current.orgId,
          userId: (session.user as { id?: string }).id ?? null,
          action: "platform.act_as_ended",
          entityType: "Organization",
          entityId: current.orgId,
          actorType: "platform",
          actorEmail: email,
          ipAddress: getRequestIp(request),
          metadata: { mode: current.mode },
        },
      })
      .catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACT_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
