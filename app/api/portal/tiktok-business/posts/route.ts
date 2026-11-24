import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { fetchTikTokBusinessPosts } from "@/lib/platforms/tiktokBusiness";
import { tiktokBusinessAccess } from "@/lib/portal/tiktokBusinessConnection";
import { createLogger } from "@/lib/observability/logger";
import { noStore, refusal, tiktokFailure } from "../shared";

export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "TIKTOK", call: "business.posts" } });

/** GET /api/portal/tiktok-business/posts — the creator's recent posts with
    their insights (reach, watch time, retention, traffic sources, viewers). */
export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await tiktokBusinessAccess(session.creatorUserId);
  if (!access.ok) return refusal(access);
  try {
    const posts = await fetchTikTokBusinessPosts(access.token, access.businessId, 12);
    return NextResponse.json({ posts, readAt: new Date().toISOString(), stored: false }, { headers: noStore });
  } catch (e) {
    const failed = tiktokFailure(e, "your posts");
    if (failed) return failed;
    log.error("TikTok for Business posts read failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Failed to read your posts" }, { status: 500 });
  }
}
