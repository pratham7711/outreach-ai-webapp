import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto/encrypt";
import { createLogger } from "@/lib/observability/logger";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { accountStatesFor, recordGrantor } from "./accountState";
import { ACCOUNT_ORIGINS, isInstagramLoginRow } from "./accountOrigin";

/**
 * Who granted a Meta connection, in the id Meta's callbacks use.
 *
 * Meta's deauthorize and data-deletion callbacks send `user_id`: the app-scoped
 * id of the PERSON who authorised the app. Our Facebook and
 * Instagram-via-Facebook rows store the id of the ACCOUNT that person reached
 * (a Page id, an IG business account id) as platformUserId, because that is
 * what makes two accounts on one platform distinct. So matching the callback's
 * user_id against platformUserId deleted nothing for those two platforms.
 * Threads stores the Threads user id, which is the id its callback sends, so it
 * matched — and still does; see lib/oauth/metaDeletion.ts.
 *
 * The grantor id is one `me?fields=id` with the token we just stored:
 *   - instagram / facebook: graph.facebook.com — the app-scoped Facebook user
 *   - instagram-login: graph.instagram.com — `id` is the app-scoped Instagram
 *     user, where platformUserId holds `user_id` (the account id). Which of the
 *     two an Instagram Login callback names is not something the code can
 *     settle, so the deletion match accepts either.
 */

export type GrantorPlatform = "instagram" | "facebook" | "instagram-login";

const FB_ME = "https://graph.facebook.com/v26.0/me";
const IG_ME = "https://graph.instagram.com/v23.0/me";
const REQUEST_TIMEOUT_MS = 5000;

export function isGrantorPlatform(platform: string): platform is GrantorPlatform {
  return platform === "instagram" || platform === "facebook" || platform === "instagram-login";
}

/** The grantor's app-scoped id, or null. Never throws, never logs the token. */
export async function fetchMetaGrantorId(
  platform: GrantorPlatform,
  token: string,
): Promise<string | null> {
  const url = new URL(platform === "instagram-login" ? IG_ME : FB_ME);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", token);
  try {
    const signal =
      typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined;
    const res = await fetch(url.toString(), { signal });
    if (!res?.ok) return null;
    const body = (await res.json()) as { id?: unknown };
    if (typeof body?.id === "string" && body.id) return body.id;
    if (typeof body?.id === "number") return String(body.id);
    return null;
  } catch {
    return null;
  }
}

export type GrantorBackfillResult = {
  ready: boolean;
  scanned: number;
  filled: number;
  /** Rows whose token could not be opened, or that Meta would not answer for. */
  unresolved: number;
  /** Rows that already had a grantor recorded. */
  alreadyKnown: number;
  /** Pass as `afterId` to continue; null once the last page has been read. */
  nextAfterId: string | null;
};

/**
 * Fills the grantor id for Meta rows connected before it was recorded.
 *
 * Only a row whose stored token still answers `/me` can be filled; a dead
 * token has no way to say who granted it, and those rows keep matching on
 * platformUserId alone, exactly as before. Writes only CreatorAccountState —
 * never the account row — and is safe to re-run: rows already known are
 * skipped. Exported for the admin route; nothing runs it on a schedule.
 */
export async function backfillMetaGrantors(
  options: { limit?: number; afterId?: string | null } = {},
): Promise<GrantorBackfillResult> {
  const limit = options.limit ?? 200;
  const result: GrantorBackfillResult = {
    ready: false,
    scanned: 0,
    filled: 0,
    unresolved: 0,
    alreadyKnown: 0,
    nextAfterId: null,
  };
  if (!(await connectTablesReady())) return result;
  result.ready = true;

  const rows = await db.creatorSocialAccount.findMany({
    where: {
      platform: { in: ["INSTAGRAM", "FACEBOOK"] },
      /* A manual row holds no credential ("manual-entry") and a dev row holds
         a synthetic one; neither can answer /me. */
      OR: [
        { origin: null },
        { origin: { in: [ACCOUNT_ORIGINS.OAUTH, ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN] } },
      ],
      accessToken: { not: "manual-entry" },
      /* A cursor, not an offset or a "still unfilled" filter: rows already
         filled, and rows Meta will never answer for, would otherwise sit at
         the front of every pass and the walk would never get past them. */
      ...(options.afterId ? { id: { gt: options.afterId } } : {}),
    },
    select: {
      id: true,
      platform: true,
      origin: true,
      accessToken: true,
      creator: { select: { orgId: true } },
    },
    orderBy: { id: "asc" },
    take: limit,
  });
  result.scanned = rows.length;
  result.nextAfterId = rows.length === limit ? rows[rows.length - 1].id : null;

  const known = await accountStatesFor(rows.map((r) => r.id));
  const log = createLogger({ context: { call: "meta.grantorBackfill" } });

  for (const row of rows) {
    if (known.get(row.id)?.grantorUserId) {
      result.alreadyKnown++;
      continue;
    }
    let token: string;
    try {
      token = decrypt(row.accessToken, row.creator.orgId);
    } catch {
      result.unresolved++;
      continue;
    }
    const platform: GrantorPlatform = isInstagramLoginRow(row.origin)
      ? "instagram-login"
      : row.platform === "FACEBOOK"
        ? "facebook"
        : "instagram";
    const grantor = await fetchMetaGrantorId(platform, token);
    if (!grantor) {
      result.unresolved++;
      continue;
    }
    if (await recordGrantor(row.id, grantor)) result.filled++;
    else result.unresolved++;
  }

  log.info("grantor backfill finished", { ...result });
  return result;
}
