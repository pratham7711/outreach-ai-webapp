import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";
import { db } from "@/lib/db";
import { feedbackTablesReady } from "@/lib/feedback/feedbackTables";
import {
  cleanContext,
  cleanPageUrl,
  decodeScreenshot,
  feedbackBodySchema,
  type FeedbackBody,
} from "@/lib/feedback/submission";
import { loadListShare } from "@/lib/lists/listShare";
import { requestLogger } from "@/lib/observability/requestLogger";
import { configuredLimit, rateLimit, rateLimitKey } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/feedback -- the Feedback button on every signed-in page and on the
 * client's share and list links. Stores the message, the screenshot and the
 * page context for the platform operator (/platform/feedback).
 *
 * Who sent it is never taken from the body. It is the signed-in agency user,
 * else the signed-in portal creator, else -- only on a share or list page --
 * the org of the link the body names, which must be live. Anyone else gets a
 * 401: there is no anonymous inbox for the open web to fill.
 */

type Sender =
  | { kind: "user"; orgId: string | null; userId: string | null; email: string | null; actingAs: boolean }
  | { kind: "creator"; creatorUserId: string }
  | { kind: "link"; orgId: string };

async function linkOrg(body: FeedbackBody): Promise<string | null> {
  const token = body.linkToken;
  if (!token) return null;
  if (body.surface === "share") {
    const link = await db.report.findUnique({
      where: { shareToken: token },
      select: { isPublic: true, campaign: { select: { orgId: true } } },
    });
    return link?.isPublic && link.campaign ? link.campaign.orgId : null;
  }
  if (body.surface === "list") return (await loadListShare(token))?.orgId ?? null;
  return null;
}

async function resolveSender(body: FeedbackBody): Promise<Sender | null> {
  const session = await auth();
  const user = session?.user as
    | { id?: string; email?: string | null; orgId?: string; actingAs?: unknown }
    | undefined;
  if (user) {
    return {
      kind: "user",
      orgId: user.orgId ?? null,
      userId: user.id ?? null,
      email: user.email ?? null,
      actingAs: Boolean(user.actingAs),
    };
  }
  const creator = await getCreatorSession();
  if (creator) return { kind: "creator", creatorUserId: creator.creatorUserId };
  const orgId = await linkOrg(body);
  return orgId ? { kind: "link", orgId } : null;
}

export async function POST(req: NextRequest) {
  const { logger } = requestLogger("feedback");

  const limit = rateLimit({
    key: rateLimitKey("feedback", req),
    limit: configuredLimit(process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN, 10),
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const parsed = feedbackBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;

  const pageUrl = cleanPageUrl(body.pageUrl);
  if (!pageUrl) return NextResponse.json({ error: "Invalid page address" }, { status: 400 });

  const sender = await resolveSender(body);
  if (!sender) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await feedbackTablesReady())) {
    logger.warn("feedback.table_missing");
    return NextResponse.json({ error: "Feedback can't be taken just yet. Please try again later." }, { status: 503 });
  }

  /* A screenshot that will not decode is not a reason to lose the message:
     it is kept, with why the picture is missing. */
  let screenshot: { bytes: Buffer; type: string } | null = null;
  let screenshotError = body.screenshotError ?? null;
  if (body.screenshot) {
    const decoded = decodeScreenshot(body.screenshot);
    if ("error" in decoded) screenshotError = `refused: ${decoded.error}`;
    else screenshot = decoded;
  } else if (!screenshotError) {
    screenshotError = "none sent";
  }

  const message = body.message?.trim() ? body.message.trim() : null;
  const context = {
    ...cleanContext(body.context),
    sender: sender.kind,
    ...(sender.kind === "user" && sender.actingAs ? { actingAs: true } : {}),
    build: {
      deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    },
  };

  const row = await db.feedback.create({
    data: {
      surface: body.surface,
      orgId: sender.kind === "creator" ? null : sender.orgId,
      userId: sender.kind === "user" ? sender.userId : null,
      userEmail: sender.kind === "user" ? sender.email : null,
      creatorUserId: sender.kind === "creator" ? sender.creatorUserId : null,
      linkToken: body.surface === "share" || body.surface === "list" ? (body.linkToken ?? null) : null,
      message,
      pageUrl,
      pageTitle: body.pageTitle?.trim() || null,
      screenshot: screenshot ? new Uint8Array(screenshot.bytes) : null,
      screenshotType: screenshot?.type ?? null,
      screenshotError: screenshot ? null : screenshotError,
      context,
    },
    select: { id: true },
  });

  logger.info("feedback.received", {
    id: row.id,
    surface: body.surface,
    sender: sender.kind,
    screenshotBytes: screenshot?.bytes.length ?? 0,
    hasMessage: message !== null,
  });
  return NextResponse.json({ id: row.id }, { status: 201 });
}
