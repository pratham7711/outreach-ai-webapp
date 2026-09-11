import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { OrgType } from "@/lib/generated/prisma/client";
import { requestLogger } from "@/lib/observability/requestLogger";
import { rateLimit, rateLimitKey, configuredLimit } from "@/lib/rateLimit";

import { issueEmailVerification, appOrigin } from "@/lib/emailVerification";

/* The cap is per-instance memory keyed on IP, so a whole CI suite shares one
   bucket. The e2e signup spec spends exactly five -- one each for the three
   agency tests and two for the duplicate-email test -- against a limit of five,
   which leaves nothing for Playwright's two CI retries. A single unrelated
   flake upstream therefore pushed the duplicate test past the cap and it failed
   asserting 201/409 while actually receiving 429, which reads as a signup bug
   rather than a spent budget. Configurable so the test environment can have
   headroom; absent, which is the case in production, it stays at five. */
const SIGNUP_LIMIT_PER_HOUR = configuredLimit(process.env.SIGNUP_RATE_LIMIT_PER_HOUR, 5);

const signupSchema = z.object({
  orgName: z.string().trim().min(1, "Organization name is required").max(120),
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  orgType: z.enum(["AGENCY", "BRAND"]).default("AGENCY"),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function uniqueSubdomain(base: string): Promise<string> {
  const root = base || "org";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 7)}`;
    const existing = await db.organization.findUnique({ where: { subdomain: candidate } });
    if (!existing) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export async function POST(req: NextRequest) {
  const { logger } = requestLogger("signup");
  try {
    logger.info("signup.start");

    // Creating an org is a rare, expensive action; without a cap this endpoint
    // mints unlimited tenants. Best-effort only -- lib/rateLimit is per-instance
    // memory, so the edge firewall is the real defence.
    const rl = rateLimit({
      key: rateLimitKey("signup", req),
      limit: SIGNUP_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      logger.warn("signup.rate_limited", { retryAfterSeconds: rl.retryAfterSeconds });
      return NextResponse.json(
        { error: "Too many signup attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { orgName, name, email, password, orgType } = parsed.data;

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const subdomain = await uniqueSubdomain(slugify(orgName));
    const passwordHash = await bcrypt.hash(password, 10);

    let createdUser: { id: string; orgId: string } | null = null;

    await db.$transaction(async (tx) => {
      /* free, not starter. This endpoint is the self-serve door, and the free
         tier is what a self-serve signup is meant to get: the whole product,
         and no sound trackers, because a tracker is a recurring platform fetch
         we pay for on a schedule while everything else is rows.
         It said "starter" while PLANS.free existed and was never reachable, so
         the free tier's numbers described nobody. */
      const org = await tx.organization.create({
        data: {
          name: orgName,
          subdomain,
          brandName: orgName,
          plan: "free",
          orgType: orgType as OrgType,
        },
      });

      const created = await tx.user.create({
        data: {
          orgId: org.id,
          email,
          name,
          password: passwordHash,
          role: "OWNER",
        },
        select: { id: true, orgId: true },
      });
      createdUser = created;

      /* Kept in step with Organization.plan above; getOrgEntitlements reads
         planName from here first. The other columns are left to the schema
         defaults and are not read -- see lib/entitlements.ts. */
      await tx.orgPlanConfig.create({
        data: {
          orgId: org.id,
          planName: "free",
        },
      });
    });

    /* Outside the transaction, and deliberately not awaited into the response
       contract. The account exists by this point; a mail provider having a bad
       afternoon must not turn a created account into a 500, because the user
       would retry, be told the email is already taken, and be left holding an
       account they can neither verify nor recreate. issueEmailVerification
       swallows its own failures and leaves the token in place, so
       /api/auth/resend-verification is enough to recover. */
    const verification = createdUser
      ? await issueEmailVerification({
          email,
          name,
          orgId: (createdUser as { id: string; orgId: string }).orgId,
          userId: (createdUser as { id: string; orgId: string }).id,
          origin: appOrigin(req.nextUrl.origin),
        })
      : null;

    logger.info("signup.done", { status: 201, verificationSent: verification?.sent ?? false });
    return NextResponse.json(
      {
        success: true,
        /* The signup page tells the user to go and confirm. Without this it
           would have to assume a mail went out, and say "check your inbox" on
           a deployment that has no mail provider at all. */
        verificationEmail: verification?.sent ? "sent" : "unavailable",
        ...(process.env.NODE_ENV !== "production" && verification
          ? { devVerifyUrl: verification.url }
          : {}),
      },
      { status: 201 }
    );
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("Signup failed:", error);
    return NextResponse.json({ error: "Signup failed. Please try again." }, { status: 500 });
  }
}
