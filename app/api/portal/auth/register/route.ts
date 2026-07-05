import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { hashPassword, createCreatorSession } from "@/lib/creator-auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
  handle: z.string().min(1).max(50).regex(/^[\w.]+$/, "Handle must be alphanumeric"),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  bio: z.string().max(500).optional(),
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

    const { email, password, name, handle, platform, bio } = parsed.data;

    // Check uniqueness
    const existingEmail = await db.creatorUser.findUnique({ where: { email } });
    if (existingEmail) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

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

    await createCreatorSession(creatorUser.id);

    logger.info("portal.register.done", { status: 201 });
    return NextResponse.json(creatorUser, { status: 201 });
  } catch (error) {
    console.error("Creator registration failed:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
