import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { fetchTikTokBusinessComments, fetchTikTokBusinessReplies } from "@/lib/platforms/tiktokBusiness";
import { tiktokBusinessAccess } from "@/lib/portal/tiktokBusinessConnection";
import { createLogger } from "@/lib/observability/logger";
import { noStore, refusal, tiktokFailure } from "../shared";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "TIKTOK", call: "business.comments" } });
const ID = /^[0-9A-Za-z_-]{1,64}$/;

/**
 * GET /api/portal/tiktok-business/comments?video={id}[&comment={id}] — the
 * comments on one of the creator's own posts, most liked first, or the
 * replies to one comment. Read-only, live, never stored, and the text is
 * never logged.
 */
export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const video = req.nextUrl.searchParams.get("video") ?? "";
  const comment = req.nextUrl.searchParams.get("comment");
  if (!ID.test(video) || (comment !== null && !ID.test(comment)))
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });

  const access = await tiktokBusinessAccess(session.creatorUserId);
  if (!access.ok) return refusal(access);
  try {
    const comments = comment
      ? await fetchTikTokBusinessReplies(access.token, access.businessId, video, comment)
      : await fetchTikTokBusinessComments(access.token, access.businessId, video);
    return NextResponse.json({ comments, readAt: new Date().toISOString(), stored: false }, { headers: noStore });
  } catch (e) {
    const failed = tiktokFailure(e, "the comments");
    if (failed) return failed;
    log.error("TikTok for Business comments read failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Failed to read comments" }, { status: 500 });
  }
}
