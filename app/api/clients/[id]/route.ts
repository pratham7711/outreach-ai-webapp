import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const updateClientSchema = z.object({
  name: z.string().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
  contactInfo: z.record(z.string(), z.string()).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const client = await db.client.findFirst({
      where: { id, orgId },
      include: {
        plan: true,
        campaigns: {
          where: { deletedAt: null },
          select: {
            id: true, title: true, status: true, budget: true, currency: true,
            createdAt: true, _count: { select: { activations: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { campaigns: true } },
      },
    });

    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(client);
  } catch (error) {
    console.error("GET /api/clients/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const existing = await db.client.findFirst({ where: { id, orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updateData: any = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.logoUrl !== undefined) updateData.logoUrl = parsed.data.logoUrl;
    if (parsed.data.contactInfo !== undefined) {
      updateData.contactInfo = parsed.data.contactInfo !== null
        ? JSON.stringify(parsed.data.contactInfo)
        : null;
    }

    const updated = await db.client.update({ where: { id }, data: updateData });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "client.update",
      entityType: "client",
      entityId: updated.id,
      entityLabel: updated.name,
      ipAddress: getRequestIp(req),
      before: {
        id: existing.id,
        name: existing.name,
        logoUrl: existing.logoUrl,
        contactInfo: existing.contactInfo,
      },
      after: {
        id: updated.id,
        name: updated.name,
        logoUrl: updated.logoUrl,
        contactInfo: updated.contactInfo,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/clients/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
