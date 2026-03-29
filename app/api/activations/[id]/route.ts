import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  AWAITING_DRAFT: ["DRAFT_SUBMITTED", "DECLINED"],
  DRAFT_SUBMITTED: ["AWAITING_APPROVAL", "AWAITING_DRAFT"],
  AWAITING_APPROVAL: ["APPROVED", "AWAITING_DRAFT", "DECLINED"],
  APPROVED: ["POSTING"],
  POSTING: ["POSTED"],
  POSTED: ["COMPLETE"],
  DECLINED: ["AWAITING_DRAFT"],
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const activation = await db.activation.findFirst({
    where: { id, campaign: { orgId } },
  });
  if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const { status, feedbackNotes, postedUrl } = body;

  if (status) {
    const allowed = ALLOWED_TRANSITIONS[activation.status] ?? [];
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: `Cannot transition from ${activation.status} to ${status}` }, { status: 400 });
    }
  }

  const updateData: any = {};
  if (status) updateData.status = status;
  if (feedbackNotes !== undefined) updateData.feedbackNotes = feedbackNotes;
  if (postedUrl !== undefined) updateData.postedUrl = postedUrl;

  const updated = await db.activation.update({ where: { id }, data: updateData });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const activation = await db.activation.findFirst({ where: { id, campaign: { orgId } } });
  if (!activation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.activation.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ success: true });
}
