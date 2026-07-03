import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { z } from "zod";

const signupSchema = z.object({
  orgName: z.string().trim().min(1, "Organization name is required").max(120),
  name: z.string().trim().min(1, "Your name is required").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
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
  try {
    const body = await req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const { orgName, name, email, password } = parsed.data;

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const subdomain = await uniqueSubdomain(slugify(orgName));
    const passwordHash = await bcrypt.hash(password, 10);

    await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: orgName,
          subdomain,
          brandName: orgName,
          plan: "starter",
        },
      });

      await tx.user.create({
        data: {
          orgId: org.id,
          email,
          name,
          password: passwordHash,
          role: "OWNER",
        },
      });

      await tx.orgPlanConfig.create({
        data: {
          orgId: org.id,
          planName: "starter",
        },
      });
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    console.error("Signup failed:", error);
    return NextResponse.json({ error: "Signup failed. Please try again." }, { status: 500 });
  }
}
