import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const report = await db.report.findUnique({
    where: { shareToken: token },
    include: { campaign: true },
  });

  if (!report) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!report.isPublic) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(report);
}
