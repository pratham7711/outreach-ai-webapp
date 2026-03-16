import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { name, email, password, orgName } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
