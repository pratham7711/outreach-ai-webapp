import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { decrypt } from "@/lib/crypto/encrypt";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import {
  fetchFacebookPage,
  fetchFacebookPostComments,
} from "@/lib/platforms/facebookPage";
import { createLogger } from "@/lib/observability/logger";

/**
 * Comments on a Facebook post, read live and stored nowhere.
 *
 * This route is the entire user-facing feature behind
 * `pages_read_user_content`, and it is deliberately a route rather than part of
 * the post GET: the post GET is cached and its result is written back to the
 * Post row, and neither may happen to a comment. Every response here is
 * assembled from a fresh Graph read and discarded when the request ends.
 *
 * Three properties this must keep, because they are what the App Review
 * justification promises:
 *   1. No write. There is no `db.*.update` in this file, and no column exists
 *      that could hold a comment body.
 *   2. No cache. `force-dynamic` and `revalidate = 0`, so a comment deleted at
 *      Facebook is gone from this screen on the next load rather than served
 *      from a stale copy.
 *   3. No log of the content. The Graph helper logs counts; comment bodies
 *      exist only in the response.
 *
 * It is also opt-in per view: the client calls it when someone asks to see the
 * comments, so simply opening a post detail page reads nobody's words.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { params: Promise<{ id: string; postId: string }> };

const log = createLogger({ context: { call: "post.comments" } });

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as { orgId?: string }).orgId;
    if (!orgId)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: campaignId, postId } = await params;

    /* Org scope first, and on the campaign — the same gate every other route
       under this path uses. A post id alone is not authorisation. */
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({
      where: { id: postId, campaignId },
      select: { id: true, platform: true, platformPostId: true, creatorId: true },
    });
    if (!post)
      return NextResponse.json({ error: "Post not found" }, { status: 404 });

    if (post.platform !== "FACEBOOK")
      return NextResponse.json(
        {
          error: "unsupported_platform",
          /* Named rather than silently empty: Instagram comment bodies need
             instagram_business_manage_comments, which this app has not
             requested, and TikTok publishes no comments API at all. */
          reason:
            "Live comments are available for Facebook Pages only. Other platforms need a permission this app has not requested.",
        },
        { status: 400 },
      );

    /* The Page token is minted from the creator's own user token, which lives
       on their CreatorSocialAccount row for THIS org. Scoped through the
       creator's orgId so one tenant's connection can never read for another. */
    const account = await db.creatorSocialAccount.findFirst({
      where: {
        creatorId: post.creatorId,
        platform: "FACEBOOK",
        creator: { orgId },
      },
      select: { id: true, accessToken: true, handle: true },
      orderBy: { createdAt: "desc" },
    });
    if (!account)
      return NextResponse.json(
        {
          error: "no_connection",
          reason:
            "This creator has not connected their Facebook Page, so there is no token to read comments with.",
        },
        { status: 409 },
      );

    let userToken: string;
    try {
      userToken = decrypt(account.accessToken, orgId);
    } catch {
      /* A token that will not decrypt is not a reconnect prompt's fault and
         must not be reported as an empty comment list. */
      return NextResponse.json(
        {
          error: "token_unreadable",
          reason: "The stored Facebook token could not be read. Reconnect the account.",
        },
        { status: 409 },
      );
    }

    /* Two calls, because a Page's content is not readable with a user token:
       me/accounts yields the per-Page token, and only that token can read the
       comments edge. Passing the user token to the edge returns an empty array
       rather than an error, which reads exactly like a post with no comments. */
    let page;
    let comments;
    try {
      page = await fetchFacebookPage(userToken);
      if (!page)
        return NextResponse.json(
          {
            error: "no_page",
            reason:
              "The connected Facebook account administers no Page, so this post's comments cannot be read.",
          },
          { status: 409 },
        );
      comments = await fetchFacebookPostComments(
        post.platformPostId,
        page.pageAccessToken,
      );
    } catch (err) {
      if (err instanceof InstagramAuthError) {
        log.warn("Facebook comments read rejected by Graph", {
          postId: post.id,
          status: err.status,
        });
        return NextResponse.json(
          {
            error: "reauthorize",
            reason:
              "Facebook rejected the token. The creator needs to reconnect and grant Page permissions again.",
          },
          { status: 409 },
        );
      }
      throw err;
    }

    if (!comments)
      return NextResponse.json(
        {
          error: "unreadable",
          reason:
            "Facebook did not answer for this post's comments. This is usually a permission the Page has not granted.",
        },
        { status: 502 },
      );

    return NextResponse.json(
      {
        /* The edge's own summary total, which is every top-level comment — not
           the length of `preview`, which is capped at five. */
        total: comments.total,
        preview: comments.preview,
        pageName: page.displayName || account.handle,
        readAt: new Date().toISOString(),
        /* Sent to the client so the screen can say it, rather than the promise
           living only in a code comment nobody reading the UI can see. */
        stored: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    log.error("Failed to read post comments", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to read comments" },
      { status: 500 },
    );
  }
}
