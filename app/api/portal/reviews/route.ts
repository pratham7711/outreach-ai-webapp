import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Find all org-side Creator records with matching handle
  // The handle on Creator is stored as "@handle" (with @) in some seed data
  // Check both with and without @ prefix
  const handle = session.handle;
  const creators = await db.creator.findMany({
    where: {
      OR: [
        { handle: handle },
        { handle: `@${handle}` },
        { handle: handle.replace(/^@/, "") },
      ],
    },
    select: { id: true },
  });

  if (creators.length === 0) return NextResponse.json({ reviews: [] });

  const creatorIds = creators.map((c) => c.id);

  const reviews = await db.creatorReview.findMany({
    where: { creatorId: { in: creatorIds } },
    include: {
      org: { select: { id: true, name: true } },
      campaign: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ reviews });
}
