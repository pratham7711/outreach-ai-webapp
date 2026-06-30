import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;

const PatchSchema = z.object({
  name:              z.string().min(1).max(100).optional(),
  brandName:         z.string().max(100).optional().nullable(),
  timezone:          z.string().max(50).optional(),
  currency:          z.enum(CURRENCIES).optional(),
  logoUrl:           z.string().url().optional().nullable(),
  faviconUrl:        z.string().url().optional().nullable(),
  customDomain:      z.string().max(255).optional().nullable(),
  primaryColor:      z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  secondaryColor:    z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  fontFamily:        z.string().max(100).optional(),
  bankAccountName:   z.string().max(200).optional().nullable(),
  bankAccountNumber: z.string().max(50).optional().nullable(),
  bankIFSC:          z.string().max(20).optional().nullable(),
  bankSwift:         z.string().max(20).optional().nullable(),
  bankRoutingNumber: z.string().max(20).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      name: true,
      subdomain: true,
      brandName: true,
      timezone: true,
      currency: true,
      plan: true,
      planExpiresAt: true,
      logoUrl: true,
      faviconUrl: true,
      customDomain: true,
      primaryColor: true,
      secondaryColor: true,
      accentColor: true,
      fontFamily: true,
      bankAccountName: true,
      bankAccountNumber: true,
      bankIFSC: true,
      bankSwift: true,
      bankRoutingNumber: true,
      createdAt: true,
    },
  });

  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(org);
}

export async function PATCH(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await db.organization.update({
      where: { id: orgId },
      data: parsed.data,
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "org.update",
      entityType: "organization",
      entityId: orgId,
      entityLabel: org.name,
      ipAddress: getRequestIp(req),
      before: { name: org.name, brandName: org.brandName, timezone: org.timezone },
      after: { name: updated.name, brandName: updated.brandName, timezone: updated.timezone },
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return NextResponse.json({ error: "Custom domain already in use" }, { status: 409 });
    }
    console.error("Failed to update org:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
