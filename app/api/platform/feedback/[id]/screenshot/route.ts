import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feedbackTablesReady } from "@/lib/feedback/feedbackTables";
import { operatorEmail } from "@/lib/feedback/operator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One feedback screenshot, for the operator's inbox only; 404 for anyone else. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await operatorEmail())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await feedbackTablesReady())) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { id } = await params;
  const row = await db.feedback.findUnique({ where: { id }, select: { screenshot: true, screenshotType: true } });
  if (!row?.screenshot || !row.screenshotType) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(row.screenshot), {
    headers: {
      "Content-Type": row.screenshotType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
