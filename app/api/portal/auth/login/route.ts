import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { verifyPassword, createCreatorSession } from "@/lib/creator-auth";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/portal/auth/login
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const user = await db.creatorUser.findUnique({
      where: { email: parsed.data.email },
      select: { id: true, email: true, name: true, handle: true, passwordHash: true },
    });

    if (!user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const valid = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    await createCreatorSession(user.id);

    return NextResponse.json({ id: user.id, email: user.email, name: user.name, handle: user.handle });
  } catch (error) {
    console.error("Creator login failed:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
