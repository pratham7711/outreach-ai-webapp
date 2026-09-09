import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import {
  CHART_GRANULARITIES,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  POST_TTL_MAX_DAYS,
  POST_TTL_MIN_DAYS,
  READ_CADENCES,
  effectiveChartGranularity,
  parseGranularity,
  parsePostTracking,
  readsPerTrackedPost,
} from "@/lib/trackers/granularity";

/**
 * Tracker granularity, stored on Organization.uiConfig.
 *
 * uiConfig is already the documented home for "features, nav, branding, limits"
 * (prisma/schema.prisma), so this needs no migration — which matters here,
 * because production was built with `db push` and has no _prisma_migrations
 * table for `migrate deploy` to work against.
 *
 * The two fields are kept apart on purpose. readCadence spends worker time on a
 * VPS at roughly ten seconds a sound; chartGranularity spends nothing. One
 * combined "granularity" control reads as a display preference and quietly
 * triples an operational bill.
 */
const BodySchema = z.object({
  readCadence: z.enum(READ_CADENCES).optional(),
  chartGranularity: z.enum(CHART_GRANULARITIES).optional(),
  retentionDays: z.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
  /* Post tracking is the third tracker kind and gets its own block rather than
     sharing the sound/creator one. Sounds are read from a browser at ~10s each
     and there are tens of them; posts are read from APIs and there are tens of
     thousands. An org that slows its sounds down must not thereby slow every
     campaign report, which one shared control would do silently. */
  postTracking: z
    .object({
      readCadence: z.enum(READ_CADENCES).optional(),
      chartGranularity: z.enum(CHART_GRANULARITIES).optional(),
      defaultTtlDays: z.number().int().min(POST_TTL_MIN_DAYS).max(POST_TTL_MAX_DAYS).optional(),
    })
    .optional(),
});

async function requireAdminOrg() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { orgId: (session.user as any).orgId as string };
}

export async function GET() {
  const auth_ = await requireAdminOrg();
  if ("error" in auth_) return auth_.error;

  const org = await db.organization.findUnique({
    where: { id: auth_.orgId },
    select: { uiConfig: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const granularity = parseGranularity(org.uiConfig);
  const postTracking = parsePostTracking(org.uiConfig);
  return NextResponse.json({
    ...granularity,
    // What the charts will actually use, which may be coarser than the stored
    // preference: you cannot draw finer than you sample.
    effectiveChartGranularity: effectiveChartGranularity(granularity),
    postTracking: {
      ...postTracking,
      /* The ceiling as a number rather than a vibe: what one tracked post costs
         over a full default window. The count of post trackers is unlimited, so
         this per-post figure is the only bound worth showing. */
      readsPerTrackedPost: readsPerTrackedPost(postTracking, postTracking.defaultTtlDays),
      unlimited: true,
    },
    options: {
      readCadences: READ_CADENCES,
      chartGranularities: CHART_GRANULARITIES,
      retentionDays: { min: MIN_RETENTION_DAYS, max: MAX_RETENTION_DAYS },
      postTtlDays: { min: POST_TTL_MIN_DAYS, max: POST_TTL_MAX_DAYS },
    },
  });
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

  // Merge rather than replace: uiConfig also carries nav, branding and feature
  // keys, and a PATCH of one tracker field must not drop an org's nav allowlist.
  const { postTracking: postPatch, ...trackerPatch } = parsed.data;
  const current = parseGranularity(org.uiConfig);
  const next = { ...current, ...trackerPatch };
  const nextPostTracking = { ...parsePostTracking(org.uiConfig), ...(postPatch ?? {}) };
  const base =
    org.uiConfig && typeof org.uiConfig === "object" && !Array.isArray(org.uiConfig)
      ? (org.uiConfig as Record<string, unknown>)
      : {};

  await db.organization.update({
    where: { id: orgId },
    data: { uiConfig: { ...base, trackers: next, postTracking: nextPostTracking } },
  });

  return NextResponse.json({
    ...next,
    effectiveChartGranularity: effectiveChartGranularity(next),
    postTracking: {
      ...nextPostTracking,
      readsPerTrackedPost: readsPerTrackedPost(nextPostTracking, nextPostTracking.defaultTtlDays),
      unlimited: true,
    },
  });
}
