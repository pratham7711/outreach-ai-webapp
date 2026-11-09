import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { DEFAULT_SHARE_FIELDS, listSharePath, parseShareFields, sharedListPlatforms, type ListShareFields } from "@/lib/lists/listShare";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { DEFAULT_SHARE_REVIEW, SHARE_PLATFORMS, mergeShareReview, parseShareReview, type ShareReview } from "@/lib/lists/shareSettings";

const fieldsSchema = z
  .object({ stats: z.boolean(), tags: z.boolean(), audienceCountry: z.boolean(), price: z.boolean() })
  .partial()
  .strict();
const reviewSchema = z
  .object({
    approvals: z.boolean(),
    feedback: z.boolean(),
    engagementRate: z.boolean(),
    rateTotal: z.boolean(),
    platforms: z.array(z.enum(SHARE_PLATFORMS)).max(SHARE_PLATFORMS.length),
  })
  .partial()
  .strict();
const bodySchema = z
  .object({ fields: fieldsSchema.optional(), review: reviewSchema.optional(), rotate: z.boolean().optional() })
  .strict();

type Share = { token: string; fields: unknown; revokedAt: Date | null; createdAt: Date };

/* The review switches ride inside the same `fields` JSON as a nested object,
   so the four display fields keep their exact shape for everything that reads
   them. They are reported, and accepted, only once the list-approval tables
   exist -- before that there is nothing for a client's verdict to be stored in. */
function serialize(share: Share | null, withReview = false) {
  if (!share || share.revokedAt) return { share: null };
  return {
    share: {
      token: share.token,
      path: listSharePath(share.token),
      fields: parseShareFields(share.fields),
      ...(withReview && { review: parseShareReview(share.fields) }),
      createdAt: share.createdAt.toISOString(),
    },
  };
}

const storedFields = (fields: ListShareFields, review: ShareReview | undefined) => (review ? { ...fields, review } : fields);

const hasStoredReview = (fields: unknown) =>
  Boolean(fields && typeof fields === "object" && "review" in (fields as Record<string, unknown>));

const reviewNotReady = () =>
  NextResponse.json({ error: "Client approvals aren't set up yet. An admin needs to run the list-approval migration first." }, { status: 503 });

async function gateList(request: NextRequest, id: string, permission: "creators:read" | "creators:create") {
  const gate = await requirePermission(request, permission);
  if (!gate.ok) return { ok: false as const, response: gate.response };
  if (!(await rosterTablesReady())) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Sharing isn't set up yet. An admin needs to run the roster migration first." }, { status: 503 }),
    };
  }
  const list = await db.creatorList.findFirst({ where: { id, orgId: gate.auth.orgId }, select: { id: true, name: true } });
  if (!list) return { ok: false as const, response: NextResponse.json({ error: "List not found" }, { status: 404 }) };
  return { ok: true as const, auth: gate.auth, list };
}

async function readBody(request: NextRequest) {
  const raw = await request.text();
  let json: unknown = {};
  if (raw) {
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = bodySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

// GET /api/lists/[id]/share -- the list's live link, or { share: null }.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:read");
  if (!g.ok) return g.response;
  const share = await db.creatorListShare.findUnique({ where: { listId: id } });
  const body = serialize(share, await listApprovalTablesReady());
  if (!body.share?.review) return NextResponse.json(body);
  /* The platform chips sit with the review switches, so the platforms the
     list's creators actually have are read only for a live link that has
     them. A failed read answers null, and the panel then offers every chip. */
  const platforms = await sharedListPlatforms(g.auth.orgId, id).catch((e) => {
    console.error("[list share] could not read the list's platforms", e);
    return null;
  });
  return NextResponse.json({ ...body, platforms });
}

// POST -- turn sharing on. A revoked link stays dead: turning sharing back on mints a new one.
// `rotate: true` on a live link swaps its token, killing the old URL, and keeps its settings.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const body = await readBody(request);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const ready = await listApprovalTablesReady();
  if (body.review && !ready) return reviewNotReady();

  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (existing && !existing.revokedAt) {
    if (!body.rotate) return NextResponse.json(serialize(existing, ready));
    const rotated = await db.creatorListShare.update({
      where: { listId: id },
      data: { token: randomBytes(24).toString("base64url") },
    });
    // Its own audit action: a rotation breaks a URL a client may be holding,
    // and "we rotated the link" is the answer to why theirs stopped working.
    await logAudit({
      orgId: g.auth.orgId,
      ...getAuditActor(g.auth),
      action: "list.share_rotate",
      entityType: "creator_list",
      entityId: id,
      entityLabel: g.list.name,
      ipAddress: getRequestIp(request),
    });
    return NextResponse.json(serialize(rotated, ready));
  }

  const fields: ListShareFields = { ...DEFAULT_SHARE_FIELDS, ...body.fields };
  const review = ready ? mergeShareReview(DEFAULT_SHARE_REVIEW, body.review) : undefined;
  const token = randomBytes(24).toString("base64url");
  const data = { token, fields: storedFields(fields, review), revokedAt: null, createdById: g.auth.userId ?? null };
  const share = existing
    ? await db.creatorListShare.update({ where: { listId: id }, data })
    : await db.creatorListShare.create({ data: { listId: id, orgId: g.auth.orgId, ...data } });

  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: "list.share",
    entityType: "creator_list",
    entityId: id,
    entityLabel: g.list.name,
    ipAddress: getRequestIp(request),
    after: { fields, ...(review && { review }) },
  });
  return NextResponse.json(serialize(share, ready), { status: 201 });
}

// PATCH -- change what the link shows. The link itself stays the same.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const body = await readBody(request);
  if (!body || (!body.fields && !body.review)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const ready = await listApprovalTablesReady();
  if (body.review && !ready) return reviewNotReady();

  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (!existing || existing.revokedAt) return NextResponse.json({ error: "This list isn't shared" }, { status: 404 });
  const before = parseShareFields(existing.fields);
  const fields: ListShareFields = { ...before, ...body.fields };
  // A link with no stored review stays a legacy link until someone switches review on for it.
  const beforeReview = hasStoredReview(existing.fields) ? parseShareReview(existing.fields) : undefined;
  const review = body.review ? mergeShareReview(parseShareReview(existing.fields), body.review) : beforeReview;
  const share = await db.creatorListShare.update({ where: { listId: id }, data: { fields: storedFields(fields, review) } });

  await logAudit({
    orgId: g.auth.orgId,
    ...getAuditActor(g.auth),
    action: "list.share_update",
    entityType: "creator_list",
    entityId: id,
    entityLabel: g.list.name,
    ipAddress: getRequestIp(request),
    before: { fields: before, ...(beforeReview && { review: beforeReview }) },
    after: { fields, ...(review && { review }) },
  });
  return NextResponse.json(serialize(share, ready));
}

// DELETE -- revoke. The row is kept so the audit trail and createdBy survive.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await gateList(request, id, "creators:create");
  if (!g.ok) return g.response;
  const existing = await db.creatorListShare.findUnique({ where: { listId: id } });
  if (existing && !existing.revokedAt) {
    await db.creatorListShare.update({ where: { listId: id }, data: { revokedAt: new Date() } });
    await logAudit({
      orgId: g.auth.orgId,
      ...getAuditActor(g.auth),
      action: "list.share_revoke",
      entityType: "creator_list",
      entityId: id,
      entityLabel: g.list.name,
      ipAddress: getRequestIp(request),
    });
  }
  return NextResponse.json({ share: null });
}
