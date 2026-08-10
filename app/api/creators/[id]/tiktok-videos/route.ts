import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";

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

  const account = await db.creatorSocialAccount.findUnique({
    where: { creatorId_platform: { creatorId: id, platform: "TIKTOK" } },
    select: { id: true, accessToken: true, refreshToken: true, tokenExpiry: true },
  });
  if (!account)
    return NextResponse.json(
      { error: "TikTok account not connected", videos: [] },
      { status: 409 },
    );

  const accessToken = await ensureFreshTikTokToken(account, orgId);
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
