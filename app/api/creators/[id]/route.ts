import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const updateCreatorSchema = z.object({
  name: z.string().optional(),
  handle: z.string().optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]).optional(),
  bio: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  rate: z.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  paymentInfo: z.string().nullable().optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { orgId } = result;
    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        activations: {
          where: { deletedAt: null },
          include: {
            campaign: { select: { id: true, title: true, status: true, budget: true, currency: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        posts: {
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { postedAt: "desc" },
          take: 50,
        },
        payouts: {
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: { select: { activations: true, posts: true, payouts: true } },
      },
    });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(creator);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const { orgId } = result;
    const body = await req.json();
    const parsed = updateCreatorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const existing = await db.creator.findFirst({ where: { id, orgId, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const creator = await db.creator.update({ where: { id }, data: parsed.data });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "creator.update",
      entityType: "creator",
      entityId: creator.id,
      entityLabel: creator.name,
      ipAddress: getRequestIp(req),
      before: {
        id: existing.id,
        name: existing.name,
        handle: existing.handle,
        platform: existing.platform,
      },
      after: {
        id: creator.id,
        name: creator.name,
        handle: creator.handle,
        platform: creator.platform,
      },
    });

    return NextResponse.json(creator);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
