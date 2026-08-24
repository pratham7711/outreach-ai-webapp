import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Documents attached to a campaign -- the reference's Documents tab.
 *
 * A document here is a link, not an upload: there is no file storage in this
 * stack, and adding one is a metered service and somebody's budget decision.
 * A link to wherever the contract or the brief already lives covers the same
 * need and costs nothing, so that is what this stores.
 *
 * Reads are behind campaigns:read so a viewer can open the contract; writes are
 * behind campaigns:edit_own.
 */

/* The URL is rendered as a link, so the protocol is a trust boundary rather
   than a formatting preference: `javascript:` in an href executes. zod's .url()
   defers to the URL constructor, which accepts it happily -- hence the explicit
   allowlist. */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(2_000).refine((raw) => {
    try {
      return ALLOWED_PROTOCOLS.includes(new URL(raw).protocol);
    } catch {
      return false;
    }
  }, "Give a http or https link"),
});

/* The columns predate this feature and are both required. A link has no byte
   count, so size records 0 for "unknown" -- nothing reads it -- while the type
   is genuinely known: text/uri-list is the registered type for a URI reference
   (RFC 2483), or the file's own type when the link ends in a familiar
   extension. */
const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function typeFromUrl(raw: string): string {
  const ext = new URL(raw).pathname.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? "text/uri-list";
}

/** The campaign, proven to belong to this org. */
async function reach(orgId: string, id: string) {
  return db.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true, title: true },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "campaigns:read");
  if (!gate.ok) return gate.response;
  const { orgId } = gate.auth;
  const { id } = await params;

  const campaign = await reach(orgId, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const documents = await db.document.findMany({
    where: { campaignId: id },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true, name: true, fileUrl: true, mimeType: true, uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });
  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requirePermission(request, "campaigns:edit_own");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId, userId } = result;
  const { id } = await params;

  // A document records who added it, and that column is a real foreign key --
  // an API key is not a user, so it has nobody to record.
  if (!userId) {
    return NextResponse.json(
      { error: "A document records who added it, so it cannot be added with an API key" },
      { status: 403 }
    );
  }

  const campaign = await reach(orgId, id);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { name, url } = parsed.data;

  const document = await db.document.create({
    data: {
      campaignId: id,
      name,
      fileUrl: url,
      fileSize: 0,
      mimeType: typeFromUrl(url),
      uploadedById: userId,
    },
    select: {
      id: true, name: true, fileUrl: true, mimeType: true, uploadedAt: true,
      uploadedBy: { select: { name: true, email: true } },
    },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "document.create",
    entityType: "campaign",
    entityId: campaign.id,
    entityLabel: campaign.title,
    ipAddress: getRequestIp(request),
    after: { id: document.id, name: document.name, fileUrl: document.fileUrl },
  });

  return NextResponse.json(document, { status: 201 });
}
