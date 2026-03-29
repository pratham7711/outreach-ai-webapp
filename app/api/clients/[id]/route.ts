import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
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
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const existing = await db.client.findFirst({ where: { id, orgId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { name, logoUrl, contactInfo } = body;

  const updateData: any = {};
  if (name) updateData.name = name;
  if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
  if (contactInfo) {
    // Merge with existing contact info
    let existingContact: any = {};
    try { existingContact = JSON.parse(existing.contactInfo as string ?? "{}"); } catch {}
    updateData.contactInfo = JSON.stringify({ ...existingContact, ...contactInfo });
  }

  const updated = await db.client.update({ where: { id }, data: updateData });
  return NextResponse.json(updated);
}
