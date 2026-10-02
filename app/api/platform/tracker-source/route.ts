import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { isTrackerPosition, setTrackerSwitch } from "@/lib/trackers/sourceSwitch";
import { trackerOpsReport } from "@/lib/trackers/opsReport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The tracker ops page's API (plan T7). Platform admins only -- this switch
 * moves every agency's tracker reads -- and 404 for anyone else, like the
 * other /api/platform routes.
 */
async function operatorEmail(): Promise<string | null> {
  const session = await auth();
  const email = (session?.user as { email?: string } | undefined)?.email ?? null;
  return email && isPlatformAdmin(email) ? email : null;
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET() {
  if (!(await operatorEmail())) return notFound();
  return NextResponse.json(await trackerOpsReport());
}

export async function POST(request: NextRequest) {
  const email = await operatorEmail();
  if (!email) return notFound();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isTrackerPosition(body.position)) {
    return NextResponse.json({ error: "position must be legacy, A or B" }, { status: 400 });
  }
  const result = await setTrackerSwitch({
    position: body.position,
    scopeOrgIds: Array.isArray(body.scopeOrgIds) ? body.scopeOrgIds.filter((s): s is string => typeof s === "string") : [],
    percent: typeof body.percent === "number" ? body.percent : 100,
    note: typeof body.note === "string" ? body.note.slice(0, 300) : undefined,
    changedBy: email,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true, report: await trackerOpsReport() });
}
