import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatorSession } from "@/lib/creator-auth";
import { ownInstagram } from "@/lib/portal/instagramOwnAccount";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import {
  deleteComment,
  listComments,
  mediaBelongsTo,
  mediaOfComment,
  replyToComment,
  setCommentHidden,
} from "@/lib/platforms/instagramComments";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { metaDemoMocked, metaReviewScopesOn } from "@/lib/oauth/metaReviewScopes";

/**
 * Comments on one of the creator's OWN Instagram posts (instagram_manage_comments).
 * GET ?account=&media= lists them with their replies. POST replies, hides,
 * unhides or deletes one -- only on a post the creator's own account
 * published, and only at the creator's click. Comment text is neither stored
 * nor logged.
 */
export const dynamic = "force-dynamic";

const log = createLogger({ context: { platform: "INSTAGRAM", call: "portal.comments" } });
const noStore = { "Cache-Control": "no-store" };
const ID = /^[0-9A-Za-z_-]{1,64}$/;

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reply"), account: z.string().regex(ID), comment: z.string().regex(ID), message: z.string().trim().min(1).max(2200) }),
  z.object({ action: z.enum(["hide", "unhide", "delete"]), account: z.string().regex(ID), comment: z.string().regex(ID) }),
]);

function refused(e: unknown) {
  if (e instanceof InstagramAuthError)
    return NextResponse.json(
      { error: "permission", reason: "Instagram refused this. Reconnect Instagram from My accounts and allow comment management." },
      { status: 409, headers: noStore },
    );
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!metaReviewScopesOn() && !metaDemoMocked()) return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: noStore });
  const account = req.nextUrl.searchParams.get("account") ?? "";
  const media = req.nextUrl.searchParams.get("media") ?? "";
  if (!ID.test(account) || !ID.test(media)) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: noStore });

  const own = await ownInstagram(session, account);
  if (!own.ok) return NextResponse.json({ error: own.error, reason: own.reason }, { status: own.status, headers: noStore });
  try {
    if (!(await mediaBelongsTo(own.token, media, own.igUserId)))
      return NextResponse.json({ error: "not_your_post", reason: "This post is not on your connected Instagram account." }, { status: 404, headers: noStore });
    const comments = await listComments(own.token, media);
    if (!comments) return NextResponse.json({ error: "unreadable", reason: "Instagram did not return this post's comments. Try again." }, { status: 502, headers: noStore });
    return NextResponse.json({ comments, readAt: new Date().toISOString(), stored: false }, { headers: noStore });
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Instagram comments read failed", { error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Failed to read comments" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!metaReviewScopesOn() && !metaDemoMocked()) return NextResponse.json({ error: "not_enabled" }, { status: 404, headers: noStore });
  const rl = rateLimit({ key: rateLimitKey("portal/instagram/comments", req), limit: 30, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } });

  const parsed = action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400, headers: noStore });
  const own = await ownInstagram(session, parsed.data.account);
  if (!own.ok) return NextResponse.json({ error: own.error, reason: own.reason }, { status: own.status, headers: noStore });

  try {
    const media = await mediaOfComment(own.token, parsed.data.comment);
    if (!media || !(await mediaBelongsTo(own.token, media, own.igUserId)))
      return NextResponse.json({ error: "not_your_post", reason: "That comment is not on one of your posts." }, { status: 404, headers: noStore });

    const { comment } = parsed.data;
    const done =
      parsed.data.action === "reply"
        ? await replyToComment(own.token, comment, parsed.data.message)
        : parsed.data.action === "delete"
          ? await deleteComment(own.token, comment)
          : await setCommentHidden(own.token, comment, parsed.data.action === "hide");
    log.info("Instagram comment changed", { action: parsed.data.action, done });
    if (!done) return NextResponse.json({ error: "not_done", reason: "Instagram did not accept that. Try again." }, { status: 502, headers: noStore });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    const r = refused(e);
    if (r) return r;
    log.error("Instagram comment change failed", { action: parsed.data.action, error: e instanceof Error ? e.name : "unknown" });
    return NextResponse.json({ error: "Failed to change the comment" }, { status: 500 });
  }
}
