import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { logger } = requestLogger("r/[token]");
  logger.info("share.start");
  const rl = rateLimit({ key: rateLimitKey("r/[token]", request), limit: 60, windowMs: 60 * 1000 });
  if (!rl.allowed) {
    logger.warn("share.rate_limited", { retryAfterSeconds: rl.retryAfterSeconds });
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { token } = await params;

  const report = await db.report.findUnique({
    where: { shareToken: token },
    include: { campaign: true },
  });

  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!report.isPublic) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  logger.info("share.done", { status: 200 });
  return NextResponse.json(report);
}
