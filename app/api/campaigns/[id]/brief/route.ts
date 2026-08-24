import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * A campaign's creative brief -- the rich-text block the reference puts on a
 * campaign's Overview.
 *
 * The CreativeBrief table has been in the schema since the beginning with a
 * version counter and an updatedById, and nothing ever wrote to it. This is the
 * write path: one brief per campaign (campaignId is unique), so a save is an
 * upsert, and each save bumps version and records who did it.
 *
 * The content is HTML produced by the editor. It is stored verbatim and is
 * NEVER rendered as HTML on the server or through dangerouslySetInnerHTML --
 * the only reader parses it through the editor's own schema, which keeps the
 * handful of marks and nodes the toolbar can produce and discards everything
 * else. That parse is the sanitisation boundary. Anyone adding a second reader
 * has to keep it, or add a sanitiser here first.
 *
 * Behind campaigns:edit_own rather than plain authentication, because writing a
 * campaign's brief is editing the campaign.
 */

// Long enough for a real brief with formatting, short enough that the column
// cannot be used as storage.
const bodySchema = z.object({ content: z.string().max(100_000) });

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
  if (!parsed.success) return NextResponse.json({ error: "Expected brief content" }, { status: 400 });

  const existing = await db.creativeBrief.findUnique({
    where: { campaignId: id },
    select: { content: true, version: true },
  });

  // An empty editor is an empty brief, not an HTML paragraph containing nothing.
  const content = /^(<p>(<br\s*\/?>)?<\/p>\s*)*$/.test(parsed.data.content.trim())
    ? ""
    : parsed.data.content;

  const brief = await db.creativeBrief.upsert({
    where: { campaignId: id },
    create: { campaignId: id, content, updatedById: result.userId ?? null },
    update: {
      content,
      version: { increment: 1 },
      updatedById: result.userId ?? null,
    },
    select: { content: true, version: true, updatedAt: true },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "campaign_brief.set",
    entityType: "campaign",
    entityId: campaign.id,
    entityLabel: campaign.title,
    ipAddress: getRequestIp(request),
    // The brief runs to thousands of characters, so the log records that it
    // changed and what it went from and to in length, not two copies of it.
    before: { version: existing?.version ?? null, length: existing?.content.length ?? 0 },
    after: { version: brief.version, length: brief.content.length },
  });

  return NextResponse.json(brief);
}
