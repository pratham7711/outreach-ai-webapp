import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const kit = await db.mediaKit.findUnique({
    where: { shareToken: token },
  });

  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!kit.isPublic) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json(kit);
}
