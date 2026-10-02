import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createLogger } from "@/lib/observability/logger";
import { readOverdueCrons } from "@/lib/ops/overdueCrons";

export const dynamic = "force-dynamic";

/**
 * The crons that have missed their heartbeat, for the backup scheduler on the
 * Plan B server (plan §13 B; lib/ops/overdueCrons). Read-only.
 *
 * Its own bearer token, OPS_SCHEDULER_TOKEN, not the cron secret: this route
 * only answers a question, and the box holding the token is outside Vercel.
 * Unset, the route does not exist (404), so a deployment that never set up
 * the scheduler exposes nothing. The answer is job names, cron paths and
 * minutes overdue -- no data, and no error text on failure.
 */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  const token = process.env.OPS_SCHEDULER_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const overdue = await readOverdueCrons();
    return NextResponse.json({ overdue }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    createLogger({ context: { route: "ops/overdue-crons" } }).error("overdue crons unreadable", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
