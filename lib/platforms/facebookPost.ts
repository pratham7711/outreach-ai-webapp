import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto/encrypt";
import {
  NOT_MANUAL_ORIGIN,
  grantedConnectionKeys,
  readableConnection,
} from "@/lib/creators/connectionGate";
import { createLogger } from "@/lib/observability/logger";
import { InstagramAuthError } from "./instagram";
import {
  fetchFacebookPage,
  fetchFacebookPagePermalinks,
  fetchFacebookPost,
  type FacebookPagePost,
} from "./facebookPage";
import { parseFacebookLink, type FacebookLink } from "./postUrl";

/**
 * Which connected Facebook Page a pasted post link belongs to.
 *
 * Facebook shares a Page post's numbers -- and its comments -- only with a token
 * for that Page, and the only tokens we hold are the ones creators granted when
 * they connected their Page. So a Facebook post is readable exactly when it sits
 * on a Page somebody in this org connected, and the agency should not have to
 * say which: the link is matched against those Pages here, and the post is filed
 * under the creator whose Page it is.
 *
 * A link that matches no connected Page is still added (see the posts route);
 * it simply has no numbers until its Page connects.
 */

/** A connected Page as stored, before any call to Facebook. */
export type ConnectedFacebookPage = {
  creatorId: string;
  connectionId: string;
  /** The Page id, stored as the connection's platformUserId. */
  pageId: string | null;
  /** The Page's vanity name, or its display name when it has none. */
  handle: string | null;
  userToken: string;
};

export type FacebookPostMatch = {
  creatorId: string;
  pageId: string;
  /** `{page-id}_{post-id}`: the id every later read and the comments edge use. */
  graphPostId: string;
  post: FacebookPagePost;
};

/** An org with more connected Pages than this is matched against its newest ones. */
const MAX_PAGES = 10;
const SHARE_TIMEOUT_MS = 5000;

/**
 * The org's connected Facebook Pages a reader may use: not hand-entered, and
 * granted to this org. Reads the database only.
 */
export async function connectedFacebookPages(
  orgId: string,
  { creatorId }: { creatorId?: string } = {},
): Promise<ConnectedFacebookPage[]> {
  const rows = await db.creatorSocialAccount.findMany({
    where: {
      AND: [NOT_MANUAL_ORIGIN],
      platform: "FACEBOOK",
      creator: { orgId },
      ...(creatorId ? { creatorId } : {}),
    },
    select: { id: true, creatorId: true, handle: true, platformUserId: true, origin: true, accessToken: true },
    orderBy: { createdAt: "desc" },
    take: MAX_PAGES,
  });
  if (rows.length === 0) return [];

  const granted = await grantedConnectionKeys(rows.map((r) => ({ orgId, connectionId: r.id })));
  const pages: ConnectedFacebookPage[] = [];
  for (const row of rows) {
    if (!readableConnection(granted, orgId, row) || !row.accessToken) continue;
    let userToken: string;
    try {
      userToken = decrypt(row.accessToken, orgId);
    } catch {
      continue;
    }
    pages.push({
      creatorId: row.creatorId,
      connectionId: row.id,
      pageId: row.platformUserId,
      handle: row.handle,
      userToken,
    });
  }
  return pages;
}

/**
 * Where a share link (/share/p/…, fb.watch/…) points.
 *
 * Those links name neither the Page nor the post; Facebook redirects them to the
 * real permalink. Followed without cookies, a few hops at most. `null` when the
 * redirect does not land on a post link, which is a link we still add, unread.
 */
export async function followFacebookShare(url: string): Promise<FacebookLink | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    let location: string | null;
    try {
      const res = await fetch(current, {
        redirect: "manual",
        ...(typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(SHARE_TIMEOUT_MS) } : {}),
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      location = res.headers.get("location");
    } catch {
      return null;
    }
    if (!location) return null;
    current = new URL(location, current).toString();
    const link = parseFacebookLink(current);
    if (link && !link.shared) return link;
  }
  return null;
}

/** Whether a permalink Facebook gave for a post names the id a pasted link carries. */
function permalinkNames(permalink: string | null, id: string): boolean {
  if (!permalink) return false;
  if (parseFacebookLink(permalink)?.id === id) return true;
  return permalink.split(/[/?&=#]/).includes(id);
}

/**
 * The connected Page a link's post is on, with the post itself.
 *
 * Narrowed by the Page the link names when it names one, so a vanity link costs
 * one Page's calls rather than every Page's. `knownPostId` is a Graph id already
 * stored on the post, which is read directly. Throws InstagramAuthError only
 * when every candidate Page's token was rejected, so one dead connection does not
 * hide a match on another.
 */
export async function resolveFacebookPost(
  url: string,
  pages: ConnectedFacebookPage[],
  { knownPostId, signal }: { knownPostId?: string | null; signal?: AbortSignal } = {},
): Promise<FacebookPostMatch | null> {
  if (pages.length === 0) return null;
  const known = knownPostId && /^\d+_\d+$/.test(knownPostId) ? knownPostId : null;
  let link = parseFacebookLink(url);
  if (!link) return null;
  /* A stored Graph id already says which post this is; a share link need not be
     followed again on every refresh to find out. */
  if (link.shared && !known) link = await followFacebookShare(url);
  if (!link || link.kind === "group") return null;
  const target = link;

  const knownPage = known?.split("_")[0];
  const ref = link.pageRef?.toLowerCase();
  const candidates = pages.filter((p) => {
    if (knownPage) return p.pageId === knownPage;
    if (!ref) return true;
    return p.pageId === target.pageRef || p.handle?.toLowerCase() === ref;
  });

  const log = createLogger({ context: { platform: "FACEBOOK", call: "post.resolve" } });
  let authFailures = 0;
  for (const candidate of candidates) {
    try {
      const page = await fetchFacebookPage(candidate.userToken, signal);
      if (!page) continue;
      const token = page.pageAccessToken;

      const direct =
        known ?? (/^\d+$/.test(target.id) && (target.kind === "post" || target.kind === "photo") ? `${page.pageId}_${target.id}` : null);
      if (direct) {
        const post = await fetchFacebookPost(direct, token, signal);
        if (post) return { creatorId: candidate.creatorId, pageId: page.pageId, graphPostId: post.id, post };
        if (known) continue;
      }

      const listed = await fetchFacebookPagePermalinks(page.pageId, token, signal);
      const hit = listed?.find((p) => p.id === `${page.pageId}_${target.id}` || permalinkNames(p.permalink, target.id));
      if (!hit) continue;
      const post = await fetchFacebookPost(hit.id, token, signal);
      if (post) return { creatorId: candidate.creatorId, pageId: page.pageId, graphPostId: post.id, post };
    } catch (err) {
      if (!(err instanceof InstagramAuthError)) throw err;
      authFailures++;
      log.warn("A connected Page's token was rejected while matching a post", { connectionId: candidate.connectionId });
    }
  }
  if (candidates.length > 0 && authFailures === candidates.length) {
    throw new InstagramAuthError(401, undefined, "Every candidate Facebook Page token was rejected");
  }
  return null;
}

/**
 * The org's Page this link is on, or null. A chosen creator narrows the search to
 * that creator's own Pages; otherwise every connected Page in the org is tried.
 * A token Facebook rejected reads as no match here: the post is still added, and
 * the reconnect shows on the creator's own record.
 */
export async function matchFacebookPost(
  orgId: string,
  url: string,
  { creatorId }: { creatorId?: string } = {},
): Promise<FacebookPostMatch | null> {
  const pages = await connectedFacebookPages(orgId, { creatorId });
  try {
    return await resolveFacebookPost(url, pages);
  } catch (err) {
    if (err instanceof InstagramAuthError) return null;
    throw err;
  }
}
