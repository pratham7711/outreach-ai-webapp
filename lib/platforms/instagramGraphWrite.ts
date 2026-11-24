import { graphGet, InstagramAuthError } from "./instagram";
import { metaDemoMocked } from "@/lib/oauth/metaReviewScopes";
import { igDemo } from "./metaDemoMock";
import { createLogger } from "@/lib/observability/logger";

/** Writes to the Instagram Graph API on the creator's own posts, and the
    ownership check every such write is gated on. */

export const GRAPH_WRITE_BASE = "https://graph.facebook.com/v26.0";
const TIMEOUT_MS = 8000;
const log = createLogger({ context: { platform: "INSTAGRAM", call: "graph-write" } });

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
