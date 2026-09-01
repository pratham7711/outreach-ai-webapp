import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  accessFor,
  isPlatformAdmin,
  suspensionCandidates,
} from "@/lib/billing/subscription";

/**
 * Platform-operator control over agency subscriptions.
 *
 * Deliberately not under /admin, which is an *org-scoped* screen for an agency
 * managing its own clients. This is the layer above: you, looking at every
 * agency on the platform. Conflating the two is how a tenant ends up able to
 * un-suspend itself.
 *
 * Authorisation is the env allowlist rather than a role, for the same reason
 * the allowlist exists at all: every role in this product is granted *within*
 * an organisation, so an OWNER of a suspended agency would otherwise qualify to
 * lift their own suspension.
 */

function forbidden() {
  // 404, not 403. A 403 confirms the endpoint exists and that the caller is
  // simply not important enough, which is an invitation.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function requirePlatformAdmin() {
  const session = await auth();
  const email = session?.user?.email ?? null;
  if (!session?.user || !isPlatformAdmin(email)) return null;
  return email;
}

export async function GET() {
  const admin = await requirePlatformAdmin();
  if (!admin) return forbidden();

  const orgs = await db.organization.findMany({
    select: {
      id: true,
      name: true,
      subdomain: true,
      plan: true,
      subscriptionStatus: true,
      paidThrough: true,
      trialEndsAt: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
      _count: { select: { users: true, campaigns: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  return NextResponse.json({
    orgs: orgs.map((o) => ({ ...o, access: accessFor(o, now) })),
    // Suggested, never applied — the cron does not suspend anyone, a person does.
    suspensionCandidates: suspensionCandidates(orgs, now).map((c) => ({
      orgId: c.org.id,
      name: c.org.name,
      daysOverdue: c.daysOverdue,
    })),
  });
}

const PatchSchema = z.object({
  orgId: z.string().min(1),
  subscriptionStatus: z
    .enum(["TRIALING", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"])
    .optional(),
  /** ISO date, or null to clear. Recording a payment is just moving this forward. */
  paidThrough: z.string().datetime().nullable().optional(),
  trialEndsAt: z.string().datetime().nullable().optional(),
  /** Shown verbatim to everyone at the agency on the login screen. */
  suspendedReason: z.string().max(300).nullable().optional(),
});

export async function PATCH(request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (!admin) return forbidden();

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { orgId, ...patch } = parsed.data;

  const before = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, subscriptionStatus: true },
  });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const suspending = patch.subscriptionStatus === "SUSPENDED";
  const unsuspending =
    patch.subscriptionStatus && patch.subscriptionStatus !== "SUSPENDED";

  const org = await db.organization.update({
    where: { id: orgId },
    data: {
      ...(patch.subscriptionStatus ? { subscriptionStatus: patch.subscriptionStatus } : {}),
      ...(patch.paidThrough !== undefined
        ? { paidThrough: patch.paidThrough ? new Date(patch.paidThrough) : null }
        : {}),
      ...(patch.trialEndsAt !== undefined
        ? { trialEndsAt: patch.trialEndsAt ? new Date(patch.trialEndsAt) : null }
        : {}),
      ...(patch.suspendedReason !== undefined ? { suspendedReason: patch.suspendedReason } : {}),
      // Stamped here rather than left to the caller, so "when were they cut off"
      // is always answerable and always true.
      ...(suspending ? { suspendedAt: new Date() } : {}),
      ...(unsuspending ? { suspendedAt: null, suspendedReason: null } : {}),
    },
    select: {
      id: true,
      name: true,
      subscriptionStatus: true,
      paidThrough: true,
      trialEndsAt: true,
      suspendedAt: true,
      suspendedReason: true,
    },
  });

  /* Cutting off or restoring a whole agency is the most consequential button on
     the platform. It leaves a trail naming the operator, not just the change. */
  if (patch.subscriptionStatus && patch.subscriptionStatus !== before.subscriptionStatus) {
    await db.auditLog
      .create({
        data: {
          orgId,
          action: "subscription.status_changed",
          entityType: "Organization",
          entityId: orgId,
          entityLabel: before.name,
          // The operator goes in the column built for it, not into metadata,
          // so "who cut this agency off" is queryable rather than grep-able.
          actorType: "platform",
          actorEmail: admin,
          before: { subscriptionStatus: before.subscriptionStatus },
          metadata: {
            to: patch.subscriptionStatus,
            reason: patch.suspendedReason ?? null,
          },
        },
      })
      .catch(() => {
        /* An audit write must never be the reason a suspension fails to apply. */
      });
  }

  return NextResponse.json({ org, access: accessFor(org, new Date()) });
}
