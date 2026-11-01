import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { ORG_GRANT_ONLY_FEATURES } from "@/lib/featureKeys";

export const dynamic = "force-dynamic";

/**
 * Switches a grant-only feature (Creator Finder, Song Scout) on or off for ONE
 * org. The org-level feature map has no screen, and these features are never
 * sold by a plan, so this is the only way they are granted.
 *
 * GET ?orgId=... reports what the org has and changes nothing. POST
 * {orgId, feature, enabled} changes exactly one key in
 * OrgPlanConfig.features and reports before and after.
 *
 * It touches nothing else on the row. An org with no OrgPlanConfig row gets one
 * whose planName is the org's own plan, which is the name its entitlements
 * already resolve to (lib/entitlements.ts reads planConfig.planName, then
 * Organization.plan), so its plan and limits stay exactly as they were.
 */
function authorize(request: NextRequest) {
  const token = process.env.ADMIN_MIGRATE_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function isGrantOnly(value: unknown): value is (typeof ORG_GRANT_ONLY_FEATURES)[number] {
  return typeof value === "string" && (ORG_GRANT_ONLY_FEATURES as readonly string[]).includes(value);
}

async function report(orgId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, plan: true, planConfig: { select: { planName: true, features: true } } },
  });
  if (!org) return null;
  const features = (org.planConfig?.features ?? {}) as Record<string, unknown>;
  return {
    orgId: org.id,
    name: org.name,
    plan: org.planConfig?.planName ?? org.plan,
    hasConfigRow: Boolean(org.planConfig),
    grantOnly: Object.fromEntries(ORG_GRANT_ONLY_FEATURES.map((k) => [k, features[k] === true])),
  };
}

export async function GET(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const orgId = request.nextUrl.searchParams.get("orgId") ?? "";
  if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  const r = await report(orgId);
  if (!r) return NextResponse.json({ error: "No such org" }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}

export async function POST(request: NextRequest) {
  const denied = authorize(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { orgId?: unknown; feature?: unknown; enabled?: unknown } | null;
  const orgId = typeof body?.orgId === "string" ? body.orgId : "";
  if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 });
  if (!isGrantOnly(body?.feature))
    return NextResponse.json({ error: `feature must be one of ${ORG_GRANT_ONLY_FEATURES.join(", ")}` }, { status: 400 });
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });

  const before = await report(orgId);
  if (!before) return NextResponse.json({ error: "No such org" }, { status: 404 });
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true, planConfig: { select: { features: true } } } });
  const current = org?.planConfig?.features;
  const features = {
    ...(current && typeof current === "object" && !Array.isArray(current) ? (current as Prisma.InputJsonObject) : {}),
    [body.feature]: body.enabled,
  } as Prisma.InputJsonObject;

  if (org?.planConfig) {
    await db.orgPlanConfig.update({ where: { orgId }, data: { features } });
  } else {
    await db.orgPlanConfig.create({ data: { orgId, planName: org?.plan ?? "free", features } });
  }
  return NextResponse.json({ ok: true, before, after: await report(orgId) });
}
