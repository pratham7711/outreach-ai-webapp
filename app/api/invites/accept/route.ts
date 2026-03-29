import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

// POST /api/invites/accept — Accept an invite by token
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, name, password } = body;

    if (!token || !name || !password) {
      return NextResponse.json(
        { error: "Token, name, and password are required" },
        { status: 400 }
      );
    }

    if (typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const invite = await db.userInvite.findUnique({ where: { token } });

    if (!invite) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }

    if (invite.acceptedAt) {
      return NextResponse.json({ error: "Invite has already been accepted" }, { status: 410 });
    }

    if (new Date(invite.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
    }

    // Check if user with this email already exists
    const existingUser = await db.user.findUnique({ where: { email: invite.email } });
    if (existingUser) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user and mark invite as accepted in a transaction
    const user = await db.$transaction(async (tx: any) => {
      const newUser = await tx.user.create({
        data: {
          orgId: invite.orgId,
          email: invite.email,
          name,
          password: hashedPassword,
          role: invite.role,
        },
      });

      await tx.userInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return newUser;
    });

    return NextResponse.json(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to accept invite:", error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
