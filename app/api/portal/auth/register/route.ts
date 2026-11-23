import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { hashPassword } from "@/lib/creator-auth";
import { appOrigin, clearAbandonedSignup, creatorEmailState, issueCreatorVerification } from "@/lib/portal/creatorEmailVerification";
import { ErrandBody, errandQueryOf } from "../errandBody";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  handle: z.string().min(1).max(50).regex(/^[\w.]+$/, "Handle must be alphanumeric"),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  bio: z.string().max(500).optional(),
  errand: ErrandBody,
});

// POST /api/portal/auth/register
export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/auth/register");
  try {
    logger.info("portal.register.start");
    const rl = rateLimit({ key: rateLimitKey("portal/auth/register", request), limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      logger.warn("portal.register.rate_limited", { retryAfterSeconds: rl.retryAfterSeconds });
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { email, password, name, handle, platform, bio, errand } = parsed.data;

    /* Sign-up writes the account and mails the confirmation link; both need the
       confirmation table, which exists only once the deploy's DDL has run. */
    if ((await creatorEmailState("")) === "unavailable") {
      return NextResponse.json({ error: "Sign-up is being updated. Try again in a minute." }, { status: 503 });
    }
    await clearAbandonedSignup({ email });
    await clearAbandonedSignup({ handle });

    // Check uniqueness
    const existingEmail = await db.creatorUser.findUnique({ where: { email }, select: { id: true } });
    if (existingEmail) {
      const unconfirmed = (await creatorEmailState(existingEmail.id)) === "unverified";
      return NextResponse.json(
        unconfirmed
          ? { error: "This email is waiting to be confirmed. Open the link we sent, or send a new one.", needsVerification: true, email }
          : { error: "Email already registered" },
        { status: 409 },
      );
    }

    /* Uniqueness is checked against CreatorUser only, and deliberately NOT
       against the org-side Creator roster: agencies add a creator to their
       roster before that person has an account and expect them to sign up
       later with the same handle and find their campaigns waiting. Refusing
       the registration would break onboarding for every legitimate creator.

       What the handle no longer buys is access to that roster row's private
       data. Connections, insights, reviews, offers and earnings are gated on
       proven ownership — a roster row that names this account, written only
       by the creator's own join, invite, connect link or signed-in Connect —
       in lib/portal/creatorLink.ts. */
    const existingHandle = await db.creatorUser.findUnique({ where: { handle } });
    if (existingHandle) {
      return NextResponse.json({ error: "Handle already taken" }, { status: 409 });
    }

    const passwordHash = await hashPassword(password);

    const creatorUser = await db.creatorUser.create({
      data: {
        email,
        passwordHash,
        name,
        handle,
        platform: platform ?? "TIKTOK",
        bio: bio ?? null,
      },
      select: { id: true, email: true, name: true, handle: true },
    });

    /* No session: the account opens only from the link mailed to its address. */
    const issued = await issueCreatorVerification({
      email: creatorUser.email,
      name: creatorUser.name,
      origin: appOrigin(request.nextUrl.origin),
      errandQuery: errandQueryOf(errand),
    });

    logger.info("portal.register.done", { status: 201, verificationSent: issued.sent });
    return NextResponse.json(
      {
        email: creatorUser.email,
        verification: issued.sent ? "sent" : "not_sent",
        ...(process.env.NODE_ENV !== "production" && issued.url ? { devVerifyUrl: issued.url } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Creator registration failed:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
