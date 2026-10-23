import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import { fetchFacebookPage, fetchFacebookPostComments } from "@/lib/platforms/facebookPage";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/portal/insights/comments?post={page-id}_{post-id} — the comments on
 * one of the creator's OWN Facebook Page posts, for the Page owner on My stats.
 *
 * This is pages_read_user_content used the way Meta describes it: the person
 * who manages the Page reads what people wrote on it. The agency's view of the
 * same comments (app/api/campaigns/[id]/posts/[postId]/comments) keeps the
 * same three promises, and so does this route:
 *   1. No write. Nothing here touches the database except to find the
 *      creator's own connection.
 *   2. No cache. Every response is a fresh Graph read.
 *   3. No log of the content. Comment bodies exist only in the response.
 *
 * Only a post on the Page the creator's own connection administers is read:
 * a Page post id is `{page-id}_{post-id}`, and the page id must be the one
 * `me/accounts` returns for that connection's token.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_POST_ID = /^\d+_\d+$/;

const log = createLogger({ context: { call: "portal.post.comments" } });

function refuse(status: number, error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const postId = req.nextUrl.searchParams.get("post") ?? "";
    if (!PAGE_POST_ID.test(postId))
      return refuse(400, "bad_post", "That is not a Facebook Page post.");

    const creators = await findLinkedCreatorsForHandle(session);
    let sawConnection = false;
    for (const creator of creators) {
      const read = await connectionForRead(creator.orgId, creator.id, "FACEBOOK", { order: "newest" });
      if (!read.ok) continue;
      sawConnection = true;

      const token = await ensureFreshInstagramToken(read.connection, creator.orgId);
      if (!token)
        return refuse(409, "reauthorize", "Access to your Facebook Page has lapsed. Reconnect it from My accounts.");

      let page;
      let comments;
      try {
        page = await fetchFacebookPage(token);
        if (!page || !postId.startsWith(`${page.pageId}_`)) continue;
        comments = await fetchFacebookPostComments(postId, page.pageAccessToken);
      } catch (err) {
        if (err instanceof InstagramAuthError) {
          log.warn("Facebook comments read rejected by Graph", { status: err.status });
          return refuse(409, "reauthorize", "Facebook rejected the access. Reconnect your Page from My accounts.");
        }
        throw err;
      }

      if (!comments)
        return refuse(502, "unreadable", "Facebook did not return this post's comments. Try again in a moment.");

      return NextResponse.json(
        {
          total: comments.total,
          preview: comments.preview,
          pageName: page.displayName || read.connection.handle,
          readAt: new Date().toISOString(),
          stored: false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return sawConnection
      ? refuse(404, "not_your_post", "This post is not on the Facebook Page you connected.")
      : refuse(409, "no_connection", "Connect your Facebook Page from My accounts to read its comments.");
  } catch (error) {
    log.error("Failed to read the creator's Page comments", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to read comments" }, { status: 500 });
  }
}
