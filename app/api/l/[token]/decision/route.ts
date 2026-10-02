import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { loadListShare } from "@/lib/lists/listShare";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import { listItemDetails, listSummary, shareReviewSettings } from "@/lib/lists/listReview";

const MAX_NOTE = 1000;

const bodySchema = z
  .object({
    creatorId: z.string().min(1).max(64),
    decision: z.enum(["APPROVED", "REJECTED", "PENDING"]),
    note: z.string().max(MAX_NOTE * 2).optional(),
  })
  .strict();

/*
  POST /api/l/[token]/decision -- the client's verdict on one creator, from the
  public share page.

  The token is the only credential, so everything is scoped through it: the
  creator has to be on the list the token opens, in the token's own org. A
  guessed creator id from anywhere else is a 404.

  The review switches are the authorisation, not just the styling. The page
  hides the buttons when approvals are off, but the page is not the boundary --
  this route is what stands between a link shared "to look at" and someone
  posting verdicts to it anyway. Same for a note with feedback off.

  Nothing here messages anyone. The agency sees the verdict on the list's own
  page; the audit row is attributed to the link, the honest record of who acted.
*/
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const rl = rateLimit({ key: rateLimitKey("l/decision", request), limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });
  }

  const { token } = await params;
  const share = await loadListShare(token);
  if (!share || !(await listApprovalTablesReady())) {
    return NextResponse.json({ error: "This link is no longer active" }, { status: 404 });
  }

  const settings = await shareReviewSettings(token);
  if (!settings.approvals) return NextResponse.json({ error: "This list is shared for viewing only" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { creatorId, decision } = parsed.data;
  const note = parsed.data.note?.trim() ?? "";
  if (note.length > MAX_NOTE) return NextResponse.json({ error: "Note is too long" }, { status: 400 });
  if (note && !settings.feedback) return NextResponse.json({ error: "Notes are not enabled for this list" }, { status: 403 });

  const item = await db.creatorListItem.findFirst({
    where: { listId: share.listId, creatorId, creator: { orgId: share.orgId, deletedAt: null } },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Creator not found on this list" }, { status: 404 });

  const before = await listItemDetails(share.orgId, share.listId);
  const items = await db.creatorListItem.findMany({
    where: { listId: share.listId, creator: { orgId: share.orgId, deletedAt: null } },
    select: { id: true },
  });
  const summaryBefore = await listSummary(share.orgId, share.listId, items.map((i) => i.id), before);
  if (summaryBefore.archived) return NextResponse.json({ error: "This list is closed for review" }, { status: 409 });

  // Undoing a verdict clears its reasoning with it; a stale note under a
  // pending row reads as a decision that was never made.
  const data = {
    decision,
    decisionNote: decision === "PENDING" ? null : note || null,
    decidedAt: decision === "PENDING" ? null : new Date(),
  };
  const saved = await db.creatorListItemDetail.upsert({
    where: { itemId: item.id },
    create: { itemId: item.id, listId: share.listId, orgId: share.orgId, ...data },
    update: data,
    select: { decision: true, decisionNote: true, decidedAt: true },
  });

  const after = new Map(before);
  after.set(item.id, { ...(before.get(item.id) ?? { rate: null, notes: null, sortOrder: null }), ...data });
  const summary = await listSummary(share.orgId, share.listId, items.map((i) => i.id), after);

  await logAudit({
    orgId: share.orgId,
    actorType: "share_link",
    action: "list.client_decision",
    entityType: "creator_list",
    entityId: share.listId,
    entityLabel: share.name,
    ipAddress: getRequestIp(request),
    metadata: { creatorId, decision, hasNote: Boolean(saved.decisionNote) },
    before: { creatorId, decision: before.get(item.id)?.decision ?? "PENDING" },
    after: { creatorId, decision, listStatus: summary.status },
  });

  return NextResponse.json({
    verdict: { decision: saved.decision, note: saved.decisionNote, decidedAt: saved.decidedAt?.toISOString() ?? null },
    list: { status: summary.status, counts: summary.counts },
  });
}
