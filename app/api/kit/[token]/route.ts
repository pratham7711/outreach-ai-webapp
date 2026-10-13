import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/* What a public kit shows to whoever holds the link, and nothing else. This
   returned the whole row -- the owning org's id, who created it, and `config`,
   which is free-form JSON the agency can put anything into -- to an
   unauthenticated caller. No page in the app reads this route today, so the
   selection is the kit's own public content: its name and its creator list.
   Every field kept was already in the old response, so a consumer that read
   one of them still finds it. */
const PUBLIC_KIT_SELECT = {
  title: true,
  slug: true,
  creatorIds: true,
  createdAt: true,
  isPublic: true,
} as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const kit = await db.mediaKit.findUnique({
    where: { shareToken: token },
    select: PUBLIC_KIT_SELECT,
  });

  if (!kit) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!kit.isPublic) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    title: kit.title,
    slug: kit.slug,
    creatorIds: kit.creatorIds,
    createdAt: kit.createdAt,
  });
}
