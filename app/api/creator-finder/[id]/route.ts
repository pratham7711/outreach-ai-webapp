import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { permissionDenial } from "@/lib/authz";
import { isMissingProspectTable } from "@/lib/creatorFinder/prospectDdl";
import { isDismissReason, isProspectStatus } from "@/lib/creatorFinder/prospects";
import { isTagKind, readStoredTags } from "@/lib/creatorFinder/aiTags";
import type { Prisma } from "@/lib/generated/prisma";

export const dynamic = "force-dynamic";

const NOTE_MAX = 2000;

/**
 * PATCH /api/creator-finder/[id] -- move a card, edit its note, or mark one of
 * the AI's tags wrong. Dismissing needs a reason; any other move clears it.
 * Every move is an event. A tag marked wrong leaves the card and is kept, with
 * who and when, so a later AI read never puts it back and the corrections can
 * become the test set for the next prompt change.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  /* Viewers read the board; moving or adding a card needs the same permission as adding a creator. */
  const denied = permissionDenial(auth, "creators:create");
  if (denied) return denied;
  const { orgId, userId } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    status?: unknown;
    note?: unknown;
    dismissReason?: unknown;
    rejectTag?: { kind?: unknown; label?: unknown };
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: noStore });
  if (body.rejectTag !== undefined && (!isTagKind(body.rejectTag?.kind) || typeof body.rejectTag?.label !== "string"))
    return NextResponse.json({ error: "Invalid tag" }, { status: 400, headers: noStore });
  if (body.status !== undefined && !isProspectStatus(body.status))
    return NextResponse.json({ error: "Unknown status" }, { status: 400, headers: noStore });
  if (body.status === "DISMISSED" && !isDismissReason(body.dismissReason))
    return NextResponse.json({ error: "Say why this creator is being dismissed." }, { status: 400, headers: noStore });
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string")
    return NextResponse.json({ error: "Invalid note" }, { status: 400, headers: noStore });

  try {
    const current = await db.creatorProspect.findFirst({ where: { id, orgId } });
    if (!current) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });

    const data: Record<string, unknown> = {};
    if (typeof body.note === "string" || body.note === null)
      data.note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, NOTE_MAX) : null;
    const moving = isProspectStatus(body.status) && body.status !== current.status;
    if (moving) {
      data.status = body.status;
      data.statusChangedAt = new Date();
      data.dismissReason = body.status === "DISMISSED" ? body.dismissReason : null;
    }
    if (body.rejectTag) {
      const stored = readStoredTags(current.aiTags);
      const kind = body.rejectTag.kind as string;
      const label = body.rejectTag.label as string;
      if (stored && stored.tags.some((t) => t.kind === kind && t.label === label)) {
        data.aiTags = {
          ...stored,
          tags: stored.tags.filter((t) => !(t.kind === kind && t.label === label)),
          rejected: [...stored.rejected, { kind, label, by: userId, at: new Date().toISOString() }],
        } as unknown as Prisma.InputJsonObject;
      }
    }
    if (!Object.keys(data).length) return NextResponse.json({ prospect: current }, { headers: noStore });

    const [prospect] = await db.$transaction([
      db.creatorProspect.update({ where: { id: current.id }, data }),
      ...(moving
        ? [
            db.creatorProspectEvent.create({
              data: { prospectId: current.id, orgId, fromStatus: current.status, toStatus: body.status as string, userId },
            }),
          ]
        : []),
    ]);
    return NextResponse.json({ prospect }, { headers: noStore });
  } catch (e) {
    if (isMissingProspectTable(e))
      return NextResponse.json({ error: "not_set_up" }, { status: 503, headers: noStore });
    return NextResponse.json({ error: "Failed to update" }, { status: 500, headers: noStore });
  }
}

/** DELETE /api/creator-finder/[id] -- take a card off the board entirely. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  /* Viewers read the board; moving or adding a card needs the same permission as adding a creator. */
  const denied = permissionDenial(auth, "creators:create");
  if (denied) return denied;
  const { id } = await params;
  try {
    const { count } = await db.creatorProspect.deleteMany({ where: { id, orgId: auth.orgId } });
    if (!count) return NextResponse.json({ error: "Not found" }, { status: 404, headers: noStore });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    if (isMissingProspectTable(e))
      return NextResponse.json({ error: "not_set_up" }, { status: 503, headers: noStore });
    return NextResponse.json({ error: "Failed to delete" }, { status: 500, headers: noStore });
  }
}
