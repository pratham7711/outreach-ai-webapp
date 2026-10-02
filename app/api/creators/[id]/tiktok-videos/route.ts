import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { connectionForRead } from "@/lib/creators/connectionGate";

// GET /api/creators/[id]/tiktok-videos — the creator's own public TikTok posts
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const result = await authenticateRequest(req);
  if (!result)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* The creator's first-connected TikTok account. A creator may now link more
     than one, so this is no longer a unique lookup — when this route needs to
     serve a specific one it will have to take an account id, rather than
     silently pick. Read through the grant gate: a connection this org holds no
     live grant for answers exactly like no connection at all. */
  const read = await connectionForRead(orgId, id, "TIKTOK", { order: "oldest" });
  if (!read.ok)
    return NextResponse.json(
      { error: "TikTok account not connected", videos: [] },
      { status: 409 },
    );

  const accessToken = await ensureFreshTikTokToken(read.connection, orgId);
  if (!accessToken)
    return NextResponse.json(
      { error: "TikTok authorization expired — reconnect the account", videos: [] },
      { status: 409 },
    );

  const videos = await fetchTikTokVideos(accessToken);
  if (videos === null)
    return NextResponse.json(
      { error: "TikTok authorization expired — reconnect the account", videos: [] },
      { status: 409 },
    );

  return NextResponse.json({ videos });
}
