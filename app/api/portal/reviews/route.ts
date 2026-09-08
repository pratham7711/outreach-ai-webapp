import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";

export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/* findLinkedCreatorsForHandle, not findCreatorsForHandle: a handle match alone
   is not ownership. Registration checks uniqueness only against CreatorUser, so
   signing up as an existing roster creator's handle used to hand the new
   account this data. See lib/portal/creatorLink.ts. */
  const creators = await findLinkedCreatorsForHandle(session);

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
