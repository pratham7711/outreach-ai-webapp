import { NextRequest, NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/bearer";
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
 * minutes overdue, plus when to ask next -- no data, and no error text on
 * failure.
 */
export async function GET(request: NextRequest) {
  const token = process.env.OPS_SCHEDULER_TOKEN;
  if (!token) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { overdue, recheckInMinutes } = await readOverdueCrons();
    return NextResponse.json({ overdue, recheckInMinutes }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    createLogger({ context: { route: "ops/overdue-crons" } }).error("overdue crons unreadable", {
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
