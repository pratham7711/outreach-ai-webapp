import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Which of the org's campaign tags are on a campaign -- the reference's "Select
 * Tags" control on a campaign's Overview.
 *
 * The definitions live in Settings → General. Like the creator labels, this
 * replaces the whole set rather than offering add and remove: the picker knows
 * the full selection, and a set means applying the same tag twice leaves one tag
 * instead of failing on a duplicate key.
 *
 * Behind campaigns:edit_own rather than plain authentication, because tagging a
 * campaign is editing it.
 */

const bodySchema = z.object({ ids: z.array(z.string()).max(50) });

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;
  const { id } = await params;

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected a list of ids" }, { status: 400 });

  const ids = [...new Set(parsed.data.ids)];

  // The ids come from the request body, so each has to be proven to be this
  // org's own definition before it is linked.
  if (ids.length) {
    const owned = await db.campaignTagDef.findMany({
      where: { id: { in: ids }, orgId },
      select: { id: true },
    });
    if (owned.length !== ids.length) {
      return NextResponse.json({ error: "Unknown tag for this organisation" }, { status: 400 });
    }
  }

  const before = (await db.campaignTagLink.findMany({
    where: { campaignId: id },
    select: { tagId: true },
  })).map((r) => r.tagId);

  await db.$transaction([
    db.campaignTagLink.deleteMany({ where: { campaignId: id } }),
    ...(ids.length
      ? [db.campaignTagLink.createMany({ data: ids.map((tagId) => ({ campaignId: id, tagId })) })]
      : []),
  ]);

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "campaign_tag_link.set",
    entityType: "campaign",
    entityId: campaign.id,
    entityLabel: campaign.title,
    ipAddress: getRequestIp(request),
    before: { tags: before },
    after: { tags: ids },
  });

  return NextResponse.json({ ids });
}
