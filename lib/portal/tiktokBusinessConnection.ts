import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encrypt";
import { createLogger } from "@/lib/observability/logger";
import {
  refreshTikTokBusinessToken,
  revokeTikTokBusinessToken,
  TikTokBusinessAuthError,
  type TikTokBusinessTokens,
} from "@/lib/platforms/tiktokBusiness";
import { isMissingTikTokBusinessTable } from "./tiktokBusinessDdl";

/**
 * The creator's TikTok for Business connection: one per portal identity, read
 * only by that creator's own portal session. Tokens are sealed with the
 * creatorUserId as AAD, so a row copied onto another identity cannot be
 * opened.
 */

const SKEW_MS = 5 * 60 * 1000;
const log = createLogger({ context: { platform: "TIKTOK", call: "business.connection" } });

export type TikTokBusinessSummary = {
  username: string;
  displayName: string | null;
  scopes: string[];
  connectedAt: string;
};

export type TikTokBusinessAccess =
  | { ok: true; token: string; businessId: string; summary: TikTokBusinessSummary }
  | { ok: false; status: 409 | 503; error: "not_connected" | "reauthorize" | "unavailable"; reason: string };

const summaryOf = (row: { username: string; displayName: string | null; scopes: string; createdAt: Date }): TikTokBusinessSummary => ({
  username: row.username,
  displayName: row.displayName,
  scopes: row.scopes.split(",").filter(Boolean),
  connectedAt: row.createdAt.toISOString(),
});

export async function saveTikTokBusinessConnection(
  creatorUserId: string,
  tokens: TikTokBusinessTokens,
  profile: { username: string; displayName: string | null },
): Promise<void> {
  const data = {
    openId: tokens.openId,
    username: profile.username,
    displayName: profile.displayName,
    accessToken: encrypt(tokens.accessToken, creatorUserId),
    refreshToken: encrypt(tokens.refreshToken, creatorUserId),
    accessExpiresAt: tokens.accessExpiresAt,
    refreshExpiresAt: tokens.refreshExpiresAt,
    scopes: tokens.scope.join(","),
  };
  await db.tikTokBusinessConnection.upsert({ where: { creatorUserId }, create: { creatorUserId, ...data }, update: data });
}

export async function tiktokBusinessSummary(creatorUserId: string): Promise<TikTokBusinessSummary | null | "unavailable"> {
  try {
    const row = await db.tikTokBusinessConnection.findUnique({
      where: { creatorUserId },
      select: { username: true, displayName: true, scopes: true, createdAt: true },
    });
    return row ? summaryOf(row) : null;
  } catch (e) {
    if (isMissingTikTokBusinessTable(e)) return "unavailable";
    throw e;
  }
}

/** A token good for the next few minutes, refreshing and saving it first
    when the stored one has run out. */
export async function tiktokBusinessAccess(creatorUserId: string): Promise<TikTokBusinessAccess> {
  let row;
  try {
    row = await db.tikTokBusinessConnection.findUnique({ where: { creatorUserId } });
  } catch (e) {
    if (isMissingTikTokBusinessTable(e))
      return { ok: false, status: 503, error: "unavailable", reason: "TikTok for Business is being set up. Try again in a minute." };
    throw e;
  }
  if (!row) return { ok: false, status: 409, error: "not_connected", reason: "Connect TikTok for Business from My accounts first." };

  const lapsed = { ok: false as const, status: 409 as const, error: "reauthorize" as const, reason: "Access to your TikTok account has lapsed. Connect it again from My accounts." };
  try {
    if (row.accessExpiresAt.getTime() - SKEW_MS > Date.now()) {
      return { ok: true, token: decrypt(row.accessToken, creatorUserId), businessId: row.openId, summary: summaryOf(row) };
    }
    if (row.refreshExpiresAt.getTime() <= Date.now()) return lapsed;
    const fresh = await refreshTikTokBusinessToken(decrypt(row.refreshToken, creatorUserId));
    await db.tikTokBusinessConnection.update({
      where: { creatorUserId },
      data: {
        accessToken: encrypt(fresh.accessToken, creatorUserId),
        refreshToken: encrypt(fresh.refreshToken, creatorUserId),
        accessExpiresAt: fresh.accessExpiresAt,
        refreshExpiresAt: fresh.refreshExpiresAt,
        scopes: fresh.scope.length ? fresh.scope.join(",") : row.scopes,
      },
    });
    return { ok: true, token: fresh.accessToken, businessId: row.openId, summary: summaryOf(row) };
  } catch (e) {
    log.warn("TikTok for Business token could not be used", { error: e instanceof Error ? e.name : "unknown" });
    if (e instanceof TikTokBusinessAuthError) return lapsed;
    /* A ciphertext that will not open is as lapsed as a refused refresh. */
    if (e instanceof Error && /decrypt|auth tag|Unsupported state/i.test(e.message)) return lapsed;
    throw e;
  }
}

/** Revoke at TikTok (best effort) and forget the connection. */
export async function removeTikTokBusinessConnection(creatorUserId: string): Promise<boolean> {
  let row;
  try {
    row = await db.tikTokBusinessConnection.findUnique({ where: { creatorUserId } });
  } catch (e) {
    if (isMissingTikTokBusinessTable(e)) return false;
    throw e;
  }
  if (!row) return false;
  try {
    await revokeTikTokBusinessToken(decrypt(row.accessToken, creatorUserId));
  } catch (e) {
    log.warn("TikTok for Business revoke failed; removing the connection anyway", { error: e instanceof Error ? e.name : "unknown" });
  }
  await db.tikTokBusinessConnection.delete({ where: { creatorUserId } });
  return true;
}
