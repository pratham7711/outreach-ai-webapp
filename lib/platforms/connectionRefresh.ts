import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import type { OAuthPlatform, PlatformEnumValue } from "@/lib/oauth/providers";
import { ACCOUNT_ORIGINS, isInstagramLoginRow } from "./accountOrigin";
import { accountStatesFor, recordDisplayName } from "./accountState";
import { refreshAccountIdentity } from "./accountSync";
import { ensureFreshInstagramToken } from "./instagramToken";
import { ensureFreshInstagramLoginToken } from "./instagramLoginToken";
import { ensureFreshThreadsToken } from "./threadsToken";
import { ensureFreshTikTokToken } from "./tiktokToken";
import { ensureFreshYouTubeToken } from "./youtubeToken";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { REVOKE_REASONS } from "@/lib/creators/grants";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";

/**
 * The daily pass over creators' own connections: keep each token alive, then
 * re-read the account's profile and stats with it.
 *
 * Before this ran, a connected account's followers and media count were the
 * figures read at the moment of consent and never again (refreshAccountIdentity
 * had no callers), and an Instagram Login token was never refreshed at all, so
 * it died at day 60. Called from cron/refresh-platform-tokens, after — and
 * isolated from — the platform's own Instagram credential.
 *
 * Each row goes through the same per-platform helper its readers use, so a
 * refresh here is the refresh a reader would have done: Google's invalid_grant
 * marks the row "Reconnect needed" (never a delete), an Instagram Login token
 * is extended at graph.instagram.com, a Facebook Login one at
 * graph.facebook.com.
 */

export type ConnectionRefreshSummary = {
  considered: number;
  /** Profile and stats re-read and written. */
  refreshed: number;
  /** Marked "Reconnect needed"; not read. */
  skippedReconnect: number;
  /** No usable token: lapsed, undecryptable, or the refresh just failed. */
  noToken: number;
  /** A token, but the profile read gave nothing (or a different account). */
  identityFailed: number;
  /** Rows left for tomorrow because the time budget ran out. */
  deferred: number;
};

/** Which OAuth flow a stored row belongs to, or null for one we cannot refresh. */
export function oauthPlatformFor(platform: string, origin: string | null): OAuthPlatform | null {
  switch (platform) {
    case "INSTAGRAM":
      return isInstagramLoginRow(origin) ? "instagram-login" : "instagram";
    case "FACEBOOK":
      return "facebook";
    case "THREADS":
      return "threads";
    case "TIKTOK":
      return "tiktok";
    case "YOUTUBE":
      return "youtube";
    default:
      return null;
  }
}

type RefreshRow = {
  id: string;
  platform: string;
  origin: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiry: Date | null;
  platformUserId: string | null;
};

/** A token valid now for one row, refreshed and persisted first if due. */
export async function freshTokenFor(
  row: RefreshRow,
  oauthPlatform: OAuthPlatform,
  orgId: string,
): Promise<string | undefined> {
  switch (oauthPlatform) {
    case "tiktok":
      return ensureFreshTikTokToken(row, orgId);
    case "youtube":
      return ensureFreshYouTubeToken(row, orgId);
    case "threads":
      return ensureFreshThreadsToken(row, orgId);
    case "instagram-login":
      return ensureFreshInstagramLoginToken(row, orgId);
    /* Facebook rows hold the same Meta user token as Instagram's Facebook
       Login rows, with the same long-lived exchange. */
    case "instagram":
    case "facebook":
      return ensureFreshInstagramToken(row, orgId);
  }
}

const DEFAULT_LIMIT = 200;
const DEFAULT_CONCURRENCY = 4;

export async function refreshConnectedAccounts(options: {
  /** Epoch ms after which no new row is started. */
  deadlineAt: number;
  limit?: number;
  concurrency?: number;
}): Promise<ConnectionRefreshSummary> {
  const log = createLogger({ context: { call: "connections.refresh" } });
  const summary: ConnectionRefreshSummary = {
    considered: 0,
    refreshed: 0,
    skippedReconnect: 0,
    noToken: 0,
    identityFailed: 0,
    deferred: 0,
  };

  const rows = await db.creatorSocialAccount.findMany({
    where: {
      /* Only rows that hold a real credential. A manual row's token is the
         literal "manual-entry"; a dev row's is synthetic and no platform would
         answer it. NULL origin predates the column and may be either, so it is
         tried — a failed decrypt costs nothing and reaches no platform. */
      OR: [
        { origin: null },
        { origin: { in: [ACCOUNT_ORIGINS.OAUTH, ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN] } },
      ],
      accessToken: { not: "manual-entry" },
      creator: { deletedAt: null },
    },
    select: {
      id: true,
      platform: true,
      origin: true,
      accessToken: true,
      refreshToken: true,
      tokenExpiry: true,
      platformUserId: true,
      creator: { select: { orgId: true } },
    },
    /* Stalest first, so a run cut short by the budget picks up tomorrow where
       it stopped instead of re-reading the same front of the table. */
    orderBy: [{ statsSyncedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: options.limit ?? DEFAULT_LIMIT,
  });
  summary.considered = rows.length;
  if (rows.length === 0) return summary;

  const states = await accountStatesFor(rows.map((r) => r.id));

  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      if (Date.now() >= options.deadlineAt) {
        summary.deferred = rows.length - next;
        next = rows.length;
        return;
      }
      const row = rows[next++];
      await refreshOne(row);
    }
  };

  const refreshOne = async ({ creator, ...row }: (typeof rows)[number]) => {
    if (states.get(row.id)?.reconnectNeededAt) {
      summary.skippedReconnect++;
      return;
    }
    const oauthPlatform = oauthPlatformFor(row.platform, row.origin);
    if (!oauthPlatform) {
      summary.noToken++;
      return;
    }
    try {
      const token = await freshTokenFor(row, oauthPlatform, creator.orgId);
      if (!token) {
        summary.noToken++;
        return;
      }
      const identity = await refreshAccountIdentity(
        oauthPlatform,
        row.platform as PlatformEnumValue,
        row.id,
        token,
        row.platformUserId,
      );
      if (!identity) {
        summary.identityFailed++;
        return;
      }
      if (identity.displayName !== undefined) {
        await recordDisplayName(row.id, identity.displayName ?? null);
      }
      summary.refreshed++;
    } catch (err) {
      /* One row's failure is that row's. The ensureFresh helpers mostly
         swallow their own errors; this catches the ones that do not (a DB
         write of a refreshed token). */
      summary.identityFailed++;
      log.warn("connection refresh failed", {
        accountId: row.id,
        platform: row.platform,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const workers = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, rows.length));
  await Promise.all(Array.from({ length: workers }, worker));

  log.info("connections refreshed", { ...summary });
  return summary;
}

/**
 * Days a YouTube connection may stay "Reconnect needed" for Google's
 * invalid_grant before it is disconnected.
 *
 * YouTube API Services policy: when a user revokes access from Google's own
 * settings, what was stored through that grant must be deleted within 30 days.
 * Google tells nobody. The next refresh answers invalid_grant, and the pass
 * above refreshes every connection daily, so the mark lands within about a day
 * of the revoke. 21 leaves the creator three weeks to reconnect and a week of
 * margin for missed runs. A reconnect clears the mark, so nothing is lost by a
 * creator who comes back.
 */
export const YOUTUBE_REVOKED_DELETE_AFTER_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Disconnects every YouTube connection Google has refused for longer than
 * YOUTUBE_REVOKED_DELETE_AFTER_DAYS, exactly as the creator's own Disconnect
 * does, minus the revoke call Google has already made moot. Returns how many
 * went.
 */
export async function forgetRevokedYouTubeConnections(now = new Date()): Promise<number> {
  if (!(await connectTablesReady())) return 0;
  const cutoff = new Date(now.getTime() - YOUTUBE_REVOKED_DELETE_AFTER_DAYS * DAY_MS);
  const marked = await db.creatorAccountState.findMany({
    where: { reconnectNeededAt: { lt: cutoff }, reconnectReason: REVOKE_REASONS.INVALID_GRANT },
    select: { accountId: true },
  });
  if (marked.length === 0) return 0;
  const rows = await db.creatorSocialAccount.findMany({
    where: { id: { in: marked.map((m) => m.accountId) }, platform: "YOUTUBE" },
    select: {
      id: true,
      creatorId: true,
      platform: true,
      accessToken: true,
      origin: true,
      creator: { select: { orgId: true } },
    },
  });
  const log = createLogger({ context: { call: "connections.forgetRevokedYouTube" } });
  let forgotten = 0;
  for (const { creator, ...account } of rows) {
    try {
      await disconnectSocialAccount(account, creator.orgId, {
        alreadyRevoked: true,
        revokeReason: REVOKE_REASONS.INVALID_GRANT,
      });
      await db.creatorAccountState.deleteMany({ where: { accountId: account.id } });
      forgotten++;
    } catch (err) {
      log.warn("revoked YouTube connection could not be removed", {
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (forgotten > 0) log.info("revoked YouTube connections removed", { forgotten });
  return forgotten;
}
