import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, getAuditActor, type AuthResult } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";
import { hasPermission } from "@/lib/rbac";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { isUploadedThumbnailUrl } from "@/lib/campaigns/uploadedPicture";
import {
  CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES,
  readStoredCampaignThumbnail,
  removeCampaignThumbnail,
  storeCampaignThumbnailUpload,
} from "@/lib/campaigns/thumbnailCopy";

export const runtime = "nodejs";

/**
 * A campaign's stored picture (CampaignThumbnail), for the signed-in screens
 * of its org: the campaigns list. Org-scoped like the list itself. Serves the
 * copy only while the campaign still points at the picture it was taken from,
 * so a changed or cleared thumbnail is never answered with the old one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(req);
  if (!auth) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const width = imageDimension(req.nextUrl.searchParams.get("w"), 128);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  return serveThumbnail(await readStoredCampaignThumbnail(id, auth.orgId), width, height, resizeImage);
}

/* The same rule as editing the campaign (PATCH ../route.ts): anyone who may
   edit every campaign, or the person who created this one. */
async function editableCampaign(auth: AuthResult, id: string) {
  const campaign = await db.campaign.findFirst({
    where: { id, orgId: auth.orgId, deletedAt: null, ...campaignScopeWhereFor(auth) },
    select: { id: true, orgId: true, title: true, thumbnailUrl: true, createdById: true },
  });
  if (!campaign) return { error: NextResponse.json({ error: "Campaign not found" }, { status: 404 }) } as const;
  const canEditAny = auth.actorType === "api_key" || (auth.role != null && hasPermission(auth.role, "campaigns:edit"));
  if (!canEditAny && campaign.createdById !== auth.userId) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { campaign } as const;
}

const HEIC_TYPES = /^image\/(heic|heif)$/i;

/**
 * PUT /api/campaigns/[id]/thumbnail -- the campaign's own picture, as the
 * image bytes in the body. Shown ahead of a sound's cover on the campaigns
 * list and the client report.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const found = await editableCampaign(gate.auth, id);
  if ("error" in found) return found.error;

  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("image/")) {
    return NextResponse.json({ error: "Send a picture: JPG, PNG, WebP or HEIC." }, { status: 415 });
  }
  if (Number(req.headers.get("content-length")) > CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: "That picture is over 4 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  const result = await storeCampaignThumbnailUpload(found.campaign, bytes, req.nextUrl.origin, HEIC_TYPES.test(type));
  if (!result.stored) {
    const message = result.status === 413 ? "That picture is over 4 MB." : "That file could not be read as a picture.";
    return NextResponse.json({ error: message }, { status: result.status });
  }

  await logAudit({
    orgId: gate.auth.orgId,
    ...getAuditActor(gate.auth),
    action: "campaign.thumbnail.upload",
    entityType: "campaign",
    entityId: id,
    entityLabel: found.campaign.title,
    ipAddress: getRequestIp(req),
    before: { thumbnailUrl: found.campaign.thumbnailUrl },
    after: { thumbnailUrl: result.thumbnailUrl, bytes: result.bytes },
  });
  return NextResponse.json({ ok: true, thumbnailUrl: result.thumbnailUrl });
}

/**
 * DELETE /api/campaigns/[id]/thumbnail -- take the campaign's picture away.
 * A campaign with a sound goes back to the sound's cover, any other to its
 * initials.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(req, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const found = await editableCampaign(gate.auth, id);
  if ("error" in found) return found.error;

  await removeCampaignThumbnail(found.campaign);
  await logAudit({
    orgId: gate.auth.orgId,
    ...getAuditActor(gate.auth),
    action: "campaign.thumbnail.remove",
    entityType: "campaign",
    entityId: id,
    entityLabel: found.campaign.title,
    ipAddress: getRequestIp(req),
    before: {
      thumbnailUrl: found.campaign.thumbnailUrl,
      uploaded: isUploadedThumbnailUrl(found.campaign.thumbnailUrl, id),
    },
    after: { thumbnailUrl: null },
  });
  return NextResponse.json({ ok: true, thumbnailUrl: null });
}
