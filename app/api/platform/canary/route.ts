/**
 * The platform's own health canaries: read them, or create the ones missing.
 *
 * Guarded by the env allowlist (PLATFORM_ADMIN_EMAILS) like its siblings under
 * /api/platform, and for the same reason — these rows are infrastructure, not a
 * tenant's data, and an agency OWNER must not be able to add or repair them.
 *
 * GET answers "is every reader still writing numbers", which is the question a
 * person actually has when they ask whether Instagram is working. POST creates
 * whatever is missing and repairs a canary somebody switched off; it is
 * idempotent, so running it twice is how you check rather than something to be
 * careful about.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/billing/subscription";
import { canaryReport, provisionCanary, type CanaryTarget } from "@/lib/health/canary";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Provisioning reads every supplied post from its platform before writing it,
   so that a canary nobody can read fails in front of the operator rather than
   looking healthy until the first sweep. Three platform reads, some of them
   through a sandbox, do not fit in the default ceiling. */
export const maxDuration = 120;

type Operator = { orgId: string; userId: string };

async function operator(): Promise<Operator | null> {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string; orgId?: string } | undefined;
  if (!user || !isPlatformAdmin(user.email ?? null)) return null;
  if (!user.id || !user.orgId) return null;
  return { orgId: user.orgId, userId: user.id };
}

/** 404 rather than 403, matching /api/platform/stats: a 403 tells an attacker
 *  the endpoint is real and worth pushing on. */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: NextRequest) {
  const op = await operator();
  if (!op) return notFound();

  /* An operator can ask about another tenant's canaries, because the canary is
     the platform's instrument and the operator dashboard is where it is read
     from. Everything this returns is timestamps and metric names. */
  const orgId = request.nextUrl.searchParams.get("orgId") ?? op.orgId;
  return NextResponse.json(await canaryReport(orgId));
}

export async function POST(request: NextRequest) {
  const op = await operator();
  if (!op) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    postUrls?: unknown;
    soundUrl?: unknown;
    orgId?: unknown;
  };

  /* A string is the ordinary case; the object form exists so a link that names
     no author (an Instagram /p/ URL) can still be provisioned while Instagram
     itself is unreadable — see CanaryTarget. */
  const postUrls = Array.isArray(payload.postUrls)
    ? payload.postUrls.flatMap((u): CanaryTarget[] => {
        if (typeof u === "string") return [{ url: u }];
        if (u && typeof u === "object" && typeof (u as CanaryTarget).url === "string") {
          const t = u as CanaryTarget;
          return [{ url: t.url, ...(typeof t.handle === "string" ? { handle: t.handle } : {}) }];
        }
        return [];
      })
    : [];
  const soundUrl = typeof payload.soundUrl === "string" ? payload.soundUrl : undefined;
  if (postUrls.length === 0 && !soundUrl) {
    return NextResponse.json(
      { error: "Nothing to provision: supply postUrls and/or soundUrl" },
      { status: 400 },
    );
  }

  const orgId = typeof payload.orgId === "string" && payload.orgId ? payload.orgId : op.orgId;
  const outcome = await provisionCanary(orgId, op.userId, { postUrls, soundUrl });

  createLogger({ context: { route: "platform/canary" } }).info("canary provisioned", {
    orgId,
    created: outcome.created,
    found: outcome.found,
    failed: outcome.failed.length,
  });

  return NextResponse.json({ ...outcome, report: await canaryReport(orgId) });
}
