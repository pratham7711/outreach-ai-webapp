import { graphGet, InstagramAuthError } from "./instagram";
import { metaDemoMocked } from "@/lib/oauth/metaReviewScopes";
import { igDemo } from "./metaDemoMock";
import { createLogger } from "@/lib/observability/logger";

/**
 * Comment moderation on the creator's OWN Instagram posts
 * (instagram_manage_comments, Instagram API with Facebook Login): read the
 * comments and their replies, reply as the account, hide or unhide, delete.
 * Every change is one click by the account's owner on My stats; nothing here
 * runs on its own, and comment text is never stored or logged.
 */

export const GRAPH_WRITE_BASE = "https://graph.facebook.com/v26.0";
const TIMEOUT_MS = 8000;
const log = createLogger({ context: { platform: "INSTAGRAM", call: "comments" } });

export type IgComment = {
  id: string;
  text: string;
  username: string | null;
  likes: number | null;
  createdAt: string | null;
  hidden: boolean;
  replies: IgComment[];
};

const COMMENT_FIELDS = "id,text,username,like_count,timestamp,hidden";

function parse(c: Record<string, unknown>): IgComment {
  const replies = (c.replies as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  return {
    id: String(c.id ?? ""),
    text: typeof c.text === "string" ? c.text : "",
    username: typeof c.username === "string" ? c.username : null,
    likes: typeof c.like_count === "number" ? c.like_count : null,
    createdAt: typeof c.timestamp === "string" ? new Date(c.timestamp).toISOString() : null,
    hidden: c.hidden === true,
    replies: replies.map(parse).filter((r) => r.id),
  };
}

/** A POST or DELETE to the Graph API. Throws InstagramAuthError when Meta
    refuses the token or the permission; false for any other failure. */
export async function graphWrite(method: "POST" | "DELETE", path: string, params: Record<string, string>): Promise<boolean> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${GRAPH_WRITE_BASE}/${path}`, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.ok) {
    const data = await res.json().catch(() => null);
    return data?.success !== false;
  }
  const err = await res.json().catch(() => null);
  const code = err?.error?.code;
  log.warn("Graph write failed", { path: path.split("/").pop(), status: res.status, code });
  if (res.status === 401 || code === 190 || code === 10 || code === 200) throw new InstagramAuthError(res.status, code, err?.error?.message ?? "refused");
  return false;
}

/** Whether `mediaId` is a post of the Instagram account `igUserId`. */
export async function mediaBelongsTo(token: string, mediaId: string, igUserId: string): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.ownsMedia(mediaId);
  const data = await graphGet(mediaId, { fields: "owner{id}", access_token: token });
  return data?.owner?.id === igUserId;
}

/** The post a comment (or reply) belongs to, so a change is checked against
    the creator's own posts before it is made. */
export async function mediaOfComment(token: string, commentId: string): Promise<string | null> {
  if (metaDemoMocked()) return igDemo.mediaOfComment(commentId);
  const data = await graphGet(commentId, { fields: "media{id},parent_id", access_token: token });
  return typeof data?.media?.id === "string" ? data.media.id : null;
}

export async function listComments(token: string, mediaId: string): Promise<IgComment[] | null> {
  if (metaDemoMocked()) return igDemo.comments(mediaId).map(parse);
  const data = await graphGet(`${mediaId}/comments`, {
    fields: `${COMMENT_FIELDS},replies{${COMMENT_FIELDS}}`,
    limit: "30",
    access_token: token,
  });
  if (!data) return null;
  return ((data.data as Record<string, unknown>[]) ?? []).map(parse).filter((c) => c.id);
}

export async function replyToComment(token: string, commentId: string, message: string): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.reply(commentId, message);
  return graphWrite("POST", `${commentId}/replies`, { message, access_token: token });
}

export async function setCommentHidden(token: string, commentId: string, hide: boolean): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.hide(commentId, hide);
  return graphWrite("POST", commentId, { hide: hide ? "true" : "false", access_token: token });
}

export async function deleteComment(token: string, commentId: string): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.remove(commentId);
  return graphWrite("DELETE", commentId, { access_token: token });
}
