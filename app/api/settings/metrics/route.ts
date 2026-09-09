import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { emvEnabledFromRaw } from "@/lib/orgMetrics";

/**
 * Which computed metrics the workspace shows, stored on Organization.uiConfig.
 *
 * Same home and same reason as the tracker settings next door: uiConfig is the
 * documented place for "features, nav, branding, limits", so this needs no
 * migration — production was built with `db push` and has no _prisma_migrations
 * table for `migrate deploy` to work against.
 *
 * EMV is a modelled figure, not a measured one: it multiplies views by a
 * per-platform CPM we chose. Workspaces that report to clients on measured
 * numbers only have no use for it, and a column of invented currency is worse
 * than an absent one.
 */
const BodySchema = z.object({
  showEmv: z.boolean(),
});

async function requireAdminOrg() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const user = session.user as { role?: string; orgId?: string };
  const role = user.role ?? "";
  if (!hasPermission(role, "settings:*")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { orgId: user.orgId as string };
}

export async function GET() {
  const auth_ = await requireAdminOrg();
  if ("error" in auth_) return auth_.error;

  const org = await db.organization.findUnique({
    where: { id: auth_.orgId },
    select: { uiConfig: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ showEmv: emvEnabledFromRaw(org.uiConfig) });
}

export async function PATCH(request: NextRequest) {
  const auth_ = await requireAdminOrg();
  if ("error" in auth_) return auth_.error;
  const { orgId } = auth_;

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { uiConfig: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Merge rather than replace: uiConfig also carries nav, branding, tracker and
  // integration keys, and a PATCH of one display flag must not drop them.
  const base =
    org.uiConfig && typeof org.uiConfig === "object" && !Array.isArray(org.uiConfig)
      ? (org.uiConfig as Record<string, unknown>)
      : {};
  const metrics =
    base.metrics && typeof base.metrics === "object" && !Array.isArray(base.metrics)
      ? (base.metrics as Record<string, unknown>)
      : {};

  await db.organization.update({
    where: { id: orgId },
    data: { uiConfig: { ...base, metrics: { ...metrics, showEmv: parsed.data.showEmv } } },
  });

  return NextResponse.json({ showEmv: parsed.data.showEmv });
}
