import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feedbackTablesReady } from "@/lib/feedback/feedbackTables";
import { readInbox, type InboxFilter } from "@/lib/feedback/inbox";
import { operatorEmail } from "@/lib/feedback/operator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The feedback inbox's API. Platform operator only, and 404 for anyone else,
 * like the other /api/platform routes: feedback carries screenshots of every
 * agency's pages.
 *
 *   GET ?status=open|resolved|all     the inbox, newest first
 *   PATCH {id, resolved: boolean}     mark one resolved, or open again
 */
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

export async function GET(request: NextRequest) {
  if (!(await operatorEmail())) return notFound();
  const status = request.nextUrl.searchParams.get("status");
  const filter: InboxFilter = status === "resolved" || status === "all" ? status : "open";
  return NextResponse.json(await readInbox(filter));
}

export async function PATCH(request: NextRequest) {
  const email = await operatorEmail();
  if (!email) return notFound();
  const body = (await request.json().catch(() => null)) as { id?: unknown; resolved?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: "id and resolved are required" }, { status: 400 });
  }
  if (!(await feedbackTablesReady())) return NextResponse.json({ error: "Feedback table missing" }, { status: 503 });
  const updated = await db.feedback.updateMany({
    where: { id: body.id },
    data: body.resolved ? { resolvedAt: new Date(), resolvedBy: email } : { resolvedAt: null, resolvedBy: null },
  });
  if (updated.count === 0) return notFound();
  return NextResponse.json({ ok: true });
}
