import { encrypt, decrypt } from "@/lib/crypto/encrypt";
import { exchangeForLongLivedToken } from "@/lib/platforms/instagram";
import {
  ASSUMED_LIFETIME_DAYS,
  MIN_EXTENSION_MS,
  REFRESH_WHEN_DAYS_LEFT,
} from "@/lib/platforms/instagramBusinessToken";
import { createLogger } from "@/lib/observability/logger";

/**
 * An agency's own Instagram professional account, which that org's Business
 * Discovery reads run through (research/meta.md §3.4).
 *
 * One PlatformCredential row per org, under the provider
 * `instagram_business:org:<orgId>`, so nothing needs a new table. The token is
 * encrypted with that provider string as its AAD, as the operator credential's
 * is, and the account it reads through rides in `source` as JSON.
 *
 * An org with no row, or with a row past its expiry, has no account of its
 * own, and its reads go to the operator token exactly as before.
 */

export const AGENCY_PROVIDER_PREFIX = "instagram_business:org:";

export function agencyProvider(orgId: string): string {
  return `${AGENCY_PROVIDER_PREFIX}${orgId}`;
}

export type AgencyIgAccount = {
  igUserId: string;
  username: string;
  pageId: string | null;
  /** The Facebook user who granted it, so a Disconnect can tell whether
   *  revoking would also cut off another credential that user granted. */
  fbUserId: string | null;
};

type AgencyMeta = AgencyIgAccount & { via: "oauth" | "refresh" };

export function encodeAgencyMeta(meta: AgencyMeta): string {
  return JSON.stringify(meta);
}

export function parseAgencyMeta(source: string | null | undefined): AgencyMeta | null {
  if (!source) return null;
  try {
    const v = JSON.parse(source) as Record<string, unknown> | null;
    if (!v || typeof v.igUserId !== "string" || !v.igUserId || typeof v.username !== "string") return null;
    return {
      via: v.via === "refresh" ? "refresh" : "oauth",
      igUserId: v.igUserId,
      username: v.username,
      pageId: typeof v.pageId === "string" ? v.pageId : null,
      fbUserId: typeof v.fbUserId === "string" ? v.fbUserId : null,
    };
  } catch {
    return null;
  }
}

export type AgencyDiscoveryCredential = {
  token: string;
  igUserId: string;
  username: string;
  connectedAt: Date;
};

const CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* Per org, absences included: a sweep over a thousand posts of an org with no
   account of its own asks the database once a minute, not once a post. */
const cache = new Map<string, { value: AgencyDiscoveryCredential | null; at: number }>();

export function clearAgencyCredentialCache(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/** What the cache holds for an org: undefined when it has not been asked within the minute. */
export function peekAgencyCredential(
  orgId: string,
  nowMs = Date.now(),
): AgencyDiscoveryCredential | null | undefined {
  const hit = cache.get(orgId);
  return hit && nowMs - hit.at < CACHE_TTL_MS ? hit.value : undefined;
}

async function credentials() {
  const { db } = await import("@/lib/db");
  return db.platformCredential;
}

const log = createLogger({ context: { platform: "INSTAGRAM", lib: "instagramAgencyCredential" } });

const ROW_SELECT = {
  provider: true,
  accessToken: true,
  expiresAt: true,
  refreshedAt: true,
  lastAttemptAt: true,
  lastError: true,
  source: true,
  createdAt: true,
} as const;

type AgencyRow = {
  provider: string;
  accessToken: string;
  expiresAt: Date;
  refreshedAt: Date;
  lastAttemptAt: Date | null;
  lastError: string | null;
  source: string;
  createdAt: Date;
};

async function readRow(orgId: string): Promise<AgencyRow | null> {
  return (await credentials()).findUnique({ where: { provider: agencyProvider(orgId) }, select: ROW_SELECT });
}

/** The org's own Business Discovery account, or null when it reads with the operator token. */
export async function getAgencyDiscoveryCredential(
  orgId: string | null | undefined,
  nowMs = Date.now(),
): Promise<AgencyDiscoveryCredential | null> {
  if (!orgId) return null;
  const hit = peekAgencyCredential(orgId, nowMs);
  if (hit !== undefined) return hit;
  let value: AgencyDiscoveryCredential | null = null;
  try {
    const row = await readRow(orgId);
    const meta = parseAgencyMeta(row?.source);
    if (row && meta && row.expiresAt.getTime() > nowMs) {
      value = {
        token: decrypt(row.accessToken, agencyProvider(orgId)),
        igUserId: meta.igUserId,
        username: meta.username,
        connectedAt: row.createdAt,
      };
    }
  } catch (err) {
    log.error("agency credential unreadable; the org reads with the operator token", {
      orgId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  cache.set(orgId, { value, at: nowMs });
  return value;
}

/** Warms the cache for these orgs, so a synchronous check can peek at them. */
export async function loadAgencyDiscoveryCredentials(orgIds: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(orgIds)].map((orgId) => getAgencyDiscoveryCredential(orgId)));
}

export async function storeAgencyCredential(
  orgId: string,
  input: { accessToken: string; expiresAt: Date; account: AgencyIgAccount; now?: Date },
): Promise<void> {
  const provider = agencyProvider(orgId);
  const now = input.now ?? new Date();
  const data = {
    accessToken: encrypt(input.accessToken, provider),
    expiresAt: input.expiresAt,
    refreshedAt: now,
    lastAttemptAt: now,
    lastError: null,
    source: encodeAgencyMeta({ ...input.account, via: "oauth" }),
    /* A reconnect starts a new connection: the creator page labels a figure as
       read through this account only when it is newer than this. */
    createdAt: now,
  };
  await (await credentials()).upsert({
    where: { provider },
    create: { provider, ...data },
    update: data,
  });
  clearAgencyCredentialCache(orgId);
}

/**
 * Removes the org's row and hands back what it held, so the caller can revoke
 * the grant at Meta. Null when there was nothing to remove.
 */
export async function deleteAgencyCredential(
  orgId: string,
): Promise<{ token: string | null; account: AgencyIgAccount | null } | null> {
  const row = await readRow(orgId);
  if (!row) return null;
  let token: string | null = null;
  try {
    token = decrypt(row.accessToken, agencyProvider(orgId));
  } catch {
    token = null;
  }
  await (await credentials()).deleteMany({ where: { provider: agencyProvider(orgId) } });
  clearAgencyCredentialCache(orgId);
  const meta = parseAgencyMeta(row.source);
  return {
    token,
    account: meta ? { igUserId: meta.igUserId, username: meta.username, pageId: meta.pageId, fbUserId: meta.fbUserId } : null,
  };
}

/** Every other credential's granting Facebook user, for the revoke check. */
export async function otherAgencyGrantors(exceptOrgId: string): Promise<Set<string>> {
  const rows = await (await credentials()).findMany({
    where: { provider: { startsWith: AGENCY_PROVIDER_PREFIX, not: agencyProvider(exceptOrgId) } },
    select: { source: true },
  });
  const out = new Set<string>();
  for (const r of rows) {
    const id = parseAgencyMeta(r.source)?.fbUserId;
    if (id) out.add(id);
  }
  return out;
}

/**
 * Meta refused the token outright. Stamped expired, so the org's reads go back
 * to the operator token and its settings card asks for a reconnect, instead of
 * every read failing against a dead token until the daily refresh notices.
 */
export async function markAgencyCredentialRejected(orgId: string, reason: string, now = new Date()): Promise<void> {
  cache.set(orgId, { value: null, at: now.getTime() });
  try {
    await (await credentials()).updateMany({
      where: { provider: agencyProvider(orgId) },
      data: { expiresAt: now, lastAttemptAt: now, lastError: reason.slice(0, 500) },
    });
  } catch {
    // The cache already holds the org off the token for this process.
  }
}

export type AgencyCredentialStatus =
  | { connected: false }
  | {
      connected: true;
      igUserId: string;
      username: string;
      pageId: string | null;
      connectedAt: string;
      expiresAt: string;
      daysLeft: number;
      expired: boolean;
      lastError: string | null;
    };

export async function agencyCredentialStatus(orgId: string, nowMs = Date.now()): Promise<AgencyCredentialStatus> {
  let row: AgencyRow | null = null;
  try {
    row = await readRow(orgId);
  } catch {
    row = null;
  }
  const meta = parseAgencyMeta(row?.source);
  if (!row || !meta) return { connected: false };
  return {
    connected: true,
    igUserId: meta.igUserId,
    username: meta.username,
    pageId: meta.pageId,
    connectedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    daysLeft: Math.floor((row.expiresAt.getTime() - nowMs) / DAY_MS),
    expired: row.expiresAt.getTime() <= nowMs,
    lastError: row.lastError,
  };
}

export type AgencyRefreshStatus = "refreshed" | "not-due" | "expired" | "not-extended" | "failed";

export type AgencyRefreshSummary = {
  considered: number;
  skipped: number;
  byStatus: Record<AgencyRefreshStatus, number>;
  outcomes: { orgId: string; status: AgencyRefreshStatus; daysLeft: number | null; reason?: string }[];
};

/**
 * The daily extension the operator credential gets, for every org's own row.
 *
 * Each row is its own attempt: one org's dead token, or one write that throws,
 * is that org's outcome and never stops the rest. A row already past its
 * expiry is left alone, since Meta will not exchange an expired token and only
 * a reconnect can bring it back.
 */
export async function refreshAgencyCredentials(
  opts: { now?: Date; force?: boolean; deadlineAt?: number } = {},
): Promise<AgencyRefreshSummary> {
  const now = opts.now ?? new Date();
  const summary: AgencyRefreshSummary = {
    considered: 0,
    skipped: 0,
    byStatus: { refreshed: 0, "not-due": 0, expired: 0, "not-extended": 0, failed: 0 },
    outcomes: [],
  };
  const rows: AgencyRow[] = await (await credentials()).findMany({
    where: { provider: { startsWith: AGENCY_PROVIDER_PREFIX } },
    orderBy: { expiresAt: "asc" },
    select: ROW_SELECT,
  });

  for (let i = 0; i < rows.length; i++) {
    if (opts.deadlineAt !== undefined && Date.now() > opts.deadlineAt) {
      summary.skipped += rows.length - i;
      break;
    }
    const row = rows[i];
    const orgId = row.provider.slice(AGENCY_PROVIDER_PREFIX.length);
    summary.considered++;
    let outcome: AgencyRefreshSummary["outcomes"][number];
    try {
      outcome = { orgId, ...(await refreshOne(row, orgId, now, opts.force === true)) };
    } catch (err) {
      outcome = {
        orgId,
        status: "failed",
        daysLeft: Math.floor((row.expiresAt.getTime() - now.getTime()) / DAY_MS),
        reason: err instanceof Error ? err.message : String(err),
      };
    }
    summary.byStatus[outcome.status]++;
    summary.outcomes.push(outcome);
  }
  return summary;
}

async function refreshOne(
  row: AgencyRow,
  orgId: string,
  now: Date,
  force: boolean,
): Promise<{ status: AgencyRefreshStatus; daysLeft: number | null; reason?: string }> {
  const provider = row.provider;
  const daysLeft = Math.floor((row.expiresAt.getTime() - now.getTime()) / DAY_MS);
  if (row.expiresAt.getTime() <= now.getTime()) return { status: "expired", daysLeft };
  if (!force && daysLeft > REFRESH_WHEN_DAYS_LEFT) return { status: "not-due", daysLeft };

  const fail = async (reason: string) => {
    await (await credentials())
      .update({ where: { provider }, data: { lastAttemptAt: now, lastError: reason.slice(0, 500) } })
      .catch(() => undefined);
    return { status: "failed" as const, daysLeft, reason };
  };

  const meta = parseAgencyMeta(row.source);
  if (!meta) return fail("the stored account details could not be read");
  let current: string;
  try {
    current = decrypt(row.accessToken, provider);
  } catch (err) {
    return fail(`stored credential could not be decrypted (${err instanceof Error ? err.message : String(err)})`);
  }

  const fresh = await exchangeForLongLivedToken(current).catch(() => null);
  if (!fresh) return fail("Meta refused the exchange (the token may already be dead, or the app credentials are missing)");

  const newExpiry = fresh.expiresAt ?? new Date(now.getTime() + ASSUMED_LIFETIME_DAYS * DAY_MS);
  const extended = newExpiry.getTime() - row.expiresAt.getTime() >= MIN_EXTENSION_MS;
  await (await credentials()).update({
    where: { provider },
    data: {
      accessToken: encrypt(fresh.accessToken, provider),
      expiresAt: newExpiry,
      refreshedAt: now,
      lastAttemptAt: now,
      lastError: extended
        ? null
        : `the exchange returned a token expiring ${newExpiry.toISOString()}, no later than the one held; this account must be reconnected`,
      source: encodeAgencyMeta({ ...meta, via: "refresh" }),
    },
  });
  clearAgencyCredentialCache(orgId);
  const left = Math.floor((newExpiry.getTime() - now.getTime()) / DAY_MS);
  return { status: extended ? "refreshed" : "not-extended", daysLeft: left };
}
