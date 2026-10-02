import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { recordSourceHealth, trackerSourceTablesReady } from "@/lib/trackers/sourceSwitch";
import { dailyCheckPassed, planBCheckFinding } from "@/lib/trackers/readerAlerts";
import { alertOps } from "@/lib/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where Plan B's worker reports its daily check (plan §07): 12 public brand
 * profiles and 3 embeds read through itself. It is the only way prod learns
 * B is alive while B carries no prod reads, and the ops page refuses to
 * switch to B unless the last report here is fresh and passing.
 *
 * The worker holds this token and nothing else of ours: no database
 * credentials, no cron secret. 404 without the token configured, matching the
 * admin routes.
 */
function authorized(request: NextRequest): boolean | null {
  const token = process.env.TRACKER_PLAN_B_HEALTH_TOKEN;
  if (!token) return null;
  const presented = request.headers.get("authorization");
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

const int = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

export async function POST(request: NextRequest) {
  const auth = authorized(request);
  if (auth === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await trackerSourceTablesReady())) {
    return NextResponse.json({ error: "tracker source tables are not applied" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = body.kind === "drill" ? "drill" : "daily-check";
  const reads = int(body.reads);
  const proper = Math.min(reads, int(body.proper));
  const startedAt = new Date(String(body.startedAt ?? ""));
  const finishedAt = new Date(String(body.finishedAt ?? ""));
  const now = new Date();
  const ok = dailyCheckPassed(reads, proper);

  const previous =
    kind === "daily-check"
      ? await db.trackerSourceHealth
          .findFirst({ where: { plan: "B", kind: "daily-check" }, orderBy: { startedAt: "desc" }, select: { ok: true } })
          .catch(() => null)
      : null;

  const saved = await recordSourceHealth({
    plan: "B",
    kind,
    startedAt: Number.isNaN(startedAt.getTime()) ? now : startedAt,
    finishedAt: Number.isNaN(finishedAt.getTime()) ? now : finishedAt,
    reads,
    proper,
    walls: int(body.walls),
    failures: int(body.failures),
    medianMs: body.medianMs === null || body.medianMs === undefined ? null : int(body.medianMs),
    ok,
    detail: {
      network: typeof body.network === "string" ? body.network.slice(0, 80) : null,
      where: typeof body.where === "string" ? body.where.slice(0, 8) : null,
      embeds: typeof body.embeds === "object" && body.embeds ? body.embeds : null,
    },
  });
  if (!saved) return NextResponse.json({ error: "Not recorded" }, { status: 500 });

  if (kind === "daily-check") {
    const finding = planBCheckFinding({ ok }, previous);
    if (finding) await alertOps(finding);
  }
  return NextResponse.json({ ok: true, passed: ok });
}
