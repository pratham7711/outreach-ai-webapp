/**
 * The one place a person hands Instagram credentials to this platform.
 *
 * Guarded by the env allowlist (PLATFORM_ADMIN_EMAILS), not by a role, for the
 * same reason as its siblings under /api/platform: this credential is the
 * platform's own, shared by every tenant, so an agency OWNER must not be able
 * to rotate it. That is also why the row it writes is deliberately not
 * org-scoped -- see the comment on PlatformCredential in schema.prisma.
 *
 * GET reports the credential's health without ever reading its value; POST
 * replaces it and answers with the new expiry. Neither returns a token, and
 * neither logs one: everything here is dates, sources and error strings.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import {
  REFRESH_WHEN_DAYS_LEFT,
  instagramCredentialStatus,
  refreshInstagramBusinessToken,
  storeInstagramBusinessToken,
} from "@/lib/platforms/instagramBusinessToken";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* The POST path can make two Graph calls (exchange, then an immediate refresh
   when ?refresh=1), and Meta is not always quick. */
export const maxDuration = 60;

/** 404 rather than 403, matching /api/platform/stats: a 403 tells an attacker
 *  the endpoint is real and worth pushing on. */
async function denyUnlessOperator(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user || !isPlatformAdmin(session.user.email ?? null)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function GET() {
  const denied = await denyUnlessOperator();
  if (denied) return denied;

  const status = await instagramCredentialStatus();
  return NextResponse.json({ instagram: status, refreshWindowDays: REFRESH_WHEN_DAYS_LEFT });
}

export async function POST(request: NextRequest) {
  const denied = await denyUnlessOperator();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const token = (body as { token?: unknown } | null)?.token;
  if (typeof token !== "string" || token.trim().length === 0) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const result = await storeInstagramBusinessToken(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  /* No token, no prefix, no length: an operator who wants to know whether the
     right value landed reads the expiry, which moves only when it did. */
  createLogger({ context: { route: "platform/instagram-token" } }).info("instagram credential stored", {
    exchanged: result.exchanged,
    expiresAt: result.expiresAt.toISOString(),
  });

  return NextResponse.json({
    ok: true,
    expiresAt: result.expiresAt.toISOString(),
    /* False means Meta would not exchange it -- usually a missing
       INSTAGRAM_CLIENT_ID/SECRET -- so the stored expiry is this code's
       assumption rather than Meta's answer, and automatic renewal will not
       work until those are set. Worth saying out loud at the moment of
       storing, because the alternative is finding out in sixty days. */
    exchanged: result.exchanged,
    status: await instagramCredentialStatus(),
  });
}

/**
 * Run the renewal now.
 *
 * The cron does this daily, but an operator who has just seeded a credential
 * should not have to wait until tomorrow to learn whether renewal works at all
 * -- that answer is the whole point of moving off a hand-pasted env var.
 */
export async function PUT(request: NextRequest) {
  const denied = await denyUnlessOperator();
  if (denied) return denied;

  const force = request.nextUrl.searchParams.get("force") === "1";
  const outcome = await refreshInstagramBusinessToken({ force });
  return NextResponse.json({ outcome, status: await instagramCredentialStatus() });
}
