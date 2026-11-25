import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { createLogger } from "@/lib/observability/logger";
import { isMissingConnectionHealthTable } from "@/lib/creators/connectionHealthDdl";
import { listGrantedPages } from "./instagram";
import { debugMetaToken, type MetaTokenFacts } from "./metaDebugToken";

/**
 * Real expiry of a Facebook-Login connection, and the credential that outlives
 * the user token.
 *
 * A Meta user token lasts about 60 days and cannot be extended server-side, and
 * Meta separately ends data access 90 days after the person was last active.
 * Neither was ever read: a null tokenExpiry meant "fine forever" to the daily
 * refresher. Everything here reads Meta's own answer (debug_token), keeps the
 * earliest date anything lapses, and holds the Page token, which Meta documents
 * as not expiring when it is minted from a long-lived user token.
 *
 * Every function degrades to "nothing recorded" when the table is absent and
 * never throws: bookkeeping must not break a connection or a read.
 */

export const RECONNECT_SOON_DAYS = 14;
export const OPS_ALERT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type LapseStage = "ok" | "soon" | "critical" | "lapsed";

/** The earlier of the two dates, ignoring nulls. null when neither is known. */
export function earliestLapse(tokenExpiresAt: Date | null, dataAccessExpiresAt: Date | null): Date | null {
  const dates = [tokenExpiresAt, dataAccessExpiresAt].filter((d): d is Date => d instanceof Date);
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((d) => d.getTime())));
}

export function lapseStage(lapsesAt: Date | null | undefined, now: Date = new Date()): LapseStage {
  if (!lapsesAt) return "ok";
  const left = lapsesAt.getTime() - now.getTime();
  if (left <= 0) return "lapsed";
  if (left <= OPS_ALERT_DAYS * DAY_MS) return "critical";
  if (left <= RECONNECT_SOON_DAYS * DAY_MS) return "soon";
  return "ok";
}

const log = () => createLogger({ context: { call: "connection.health" } });

export type ConnectionHealth = {
  tokenExpiresAt: Date | null;
  dataAccessExpiresAt: Date | null;
  lapsesAt: Date | null;
  checkedAt: Date | null;
  pageId: string | null;
  pageAccessToken: string | null;
};

const HEALTH_SELECT = {
  accountId: true,
  tokenExpiresAt: true,
  dataAccessExpiresAt: true,
  lapsesAt: true,
  checkedAt: true,
  pageId: true,
  pageAccessToken: true,
} as const;

export async function connectionHealthFor(accountIds: string[]): Promise<Map<string, ConnectionHealth>> {
  const out = new Map<string, ConnectionHealth>();
  if (accountIds.length === 0) return out;
  try {
    const rows = await db.creatorConnectionHealth.findMany({
      where: { accountId: { in: accountIds } },
      select: HEALTH_SELECT,
    });
    for (const { accountId, ...health } of rows) out.set(accountId, health);
  } catch (err) {
    if (!isMissingConnectionHealthTable(err))
      log().warn("Connection health read failed", { error: err instanceof Error ? err.message : String(err) });
  }
  return out;
}

/** Accounts among `accountIds` whose earliest lapse is within the "soon" window (or past), by id. */
export async function lapsingConnections(
  accountIds: string[],
  now: Date = new Date(),
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  for (const [id, h] of await connectionHealthFor(accountIds)) {
    if (h.lapsesAt && lapseStage(h.lapsesAt, now) !== "ok") out.set(id, h.lapsesAt);
  }
  return out;
}

async function upsertHealth(accountId: string, data: Partial<Omit<ConnectionHealth, "lapsesAt">> & { lapsesAt?: Date | null }) {
  try {
    await db.creatorConnectionHealth.upsert({
      where: { accountId },
      create: { accountId, ...data },
      update: data,
    });
    return true;
  } catch (err) {
    if (!isMissingConnectionHealthTable(err))
      log().warn("Connection health write failed", {
        accountId,
        error: err instanceof Error ? err.message : String(err),
      });
    return false;
  }
}

/** Records one debug_token reading. A null reading leaves the stored dates alone. */
export async function recordTokenFacts(accountId: string, facts: MetaTokenFacts | null, now: Date = new Date()) {
  if (!facts) return false;
  return upsertHealth(accountId, {
    tokenExpiresAt: facts.expiresAt,
    dataAccessExpiresAt: facts.dataAccessExpiresAt,
    lapsesAt: earliestLapse(facts.expiresAt, facts.dataAccessExpiresAt),
    checkedAt: now,
  });
}

/**
 * The Page token stored for a connection, decrypted, or undefined. It is
 * sealed with the owning org's id, like the user token beside it.
 */
export function decryptPageToken(health: Pick<ConnectionHealth, "pageAccessToken"> | undefined, orgId: string): string | undefined {
  if (!health?.pageAccessToken) return undefined;
  try {
    return decrypt(health.pageAccessToken, orgId);
  } catch {
    return undefined;
  }
}

/**
 * Finds the Page behind a connection and stores its long-lived Page token.
 *
 * `userToken` must itself be long-lived: a Page token minted from a short-lived
 * user token expires with it, so the candidate is read back through debug_token
 * and kept only when Meta says it never expires. For an Instagram connection
 * the Page is the one whose linked Instagram account is `platformUserId`; for a
 * Facebook connection it is the Page with that id.
 */
export async function storePageToken(
  row: { id: string; platform: string; platformUserId: string | null },
  userToken: string,
  orgId: string,
): Promise<"stored" | "no-page" | "not-permanent" | "failed"> {
  if (!row.platformUserId) return "no-page";
  try {
    const pages = await listGrantedPages(userToken, "id,access_token,instagram_business_account{id}");
    const page = pages.find((p) => {
      if (typeof p.access_token !== "string" || typeof p.id !== "string") return false;
      if (row.platform === "FACEBOOK") return p.id === row.platformUserId;
      const ig = (p.instagram_business_account as { id?: unknown } | undefined)?.id;
      return ig === row.platformUserId;
    });
    if (!page) return "no-page";
    const pageToken = page.access_token as string;
    const facts = await debugMetaToken(pageToken);
    if (!facts || !facts.valid || facts.expiresAt !== null) return "not-permanent";
    const ok = await upsertHealth(row.id, { pageId: page.id as string, pageAccessToken: encrypt(pageToken, orgId) });
    return ok ? "stored" : "failed";
  } catch (err) {
    log().warn("Page token could not be stored", {
      accountId: row.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  }
}

/**
 * A fresh consent starts the record over: the dates describe the old token and
 * the Page token belongs to the old grant. Run before assessing the new token.
 */
export async function resetConnectionHealth(accountId: string): Promise<boolean> {
  return upsertHealth(accountId, {
    tokenExpiresAt: null,
    dataAccessExpiresAt: null,
    lapsesAt: null,
    checkedAt: null,
    pageId: null,
    pageAccessToken: null,
  });
}

export type MetaAssessment = {
  facts: MetaTokenFacts | null;
  /** Meta calls the token dead: no refresh can help, the creator must reconnect. */
  invalid: boolean;
  lapsesAt: Date | null;
  stage: LapseStage;
  pageToken?: "stored" | "no-page" | "not-permanent" | "failed" | "already";
};

/**
 * One Facebook-Login connection, read the way the daily pass and the connect
 * callback both need: ask Meta for the real expiry (always, so an unknown or
 * stale one is never trusted), record it, and obtain the Page token if none is
 * held yet. `token` is the user token the row currently holds.
 */
export async function assessMetaConnection(
  row: { id: string; platform: string; platformUserId: string | null },
  token: string,
  orgId: string,
  held: ConnectionHealth | undefined,
  now: Date = new Date(),
): Promise<MetaAssessment> {
  const facts = await debugMetaToken(token);
  const lapsesAt = facts?.valid ? earliestLapse(facts.expiresAt, facts.dataAccessExpiresAt) : (held?.lapsesAt ?? null);
  const assessment: MetaAssessment = {
    facts,
    invalid: facts?.valid === false,
    lapsesAt,
    stage: lapseStage(lapsesAt, now),
  };
  if (facts?.valid) {
    await recordTokenFacts(row.id, facts, now);
    if (held?.pageAccessToken) assessment.pageToken = "already";
    else assessment.pageToken = await storePageToken(row, token, orgId);
  }
  return assessment;
}
