import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { hashPassword, createCreatorSession } from "@/lib/creator-auth";

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
  try {
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

    return NextResponse.json(creatorUser, { status: 201 });
  } catch (error) {
    console.error("Creator registration failed:", error);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
