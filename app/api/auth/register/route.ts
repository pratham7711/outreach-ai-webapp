import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

/**
 * DEPRECATED duplicate of /api/signup. Nothing in this repo calls it; it exists
 * only for any external consumer predating /api/signup. It has weaker
 * validation (no zod, no email format check) and leaks whether an email is
 * registered. Delete it once you confirm no external caller depends on it.
 */
export async function POST(req: NextRequest) {
  try {
    const rl = rateLimit({
      key: rateLimitKey("auth/register", req),
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { name, email, password, orgName } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 10) {
      return NextResponse.json({ error: "Password must be at least 10 characters" }, { status: 400 });
    }
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: "Email already in use" }, { status: 400 });
    const org = await db.organization.create({
      data: {
        name: orgName || `${name}'s Workspace`,
        subdomain: email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-") + "-" + Date.now(),
      },
    });
    const hashed = await bcrypt.hash(password, 10);
    await db.user.create({
      data: { orgId: org.id, email, name, password: hashed, role: "OWNER" },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
