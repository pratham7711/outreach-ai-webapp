import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { createLogger } from "@/lib/observability/logger";

/**
 * Connect links: /connect/<token>, one per roster creator, made by the agency.
 *
 * The token is the whole credential and it binds to exactly ONE roster row
 * (orgId + creatorId). That is the point of it: today a roster creator has to
 * register a portal login whose handle matches the row exactly, and the
 * callback then finds "the" row by handle — across every agency, oldest first —
 * which is how a handle registered by the wrong person could reach another
 * agency's row. A connect link never looks at a handle.
 *
 * Only the SHA-256 of the token is stored, so a database read cannot be
 * replayed as a link; the raw token is shown to the agency once, when made.
 * Through OAuth the binding travels as the token's ROW id inside a signed
 * `state`, so the raw token never reaches Meta, Google or TikTok and the
 * callback URLs do not change.
 */

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ConnectBinding = {
  tokenId: string;
  orgId: string;
  creatorId: string;
  /** The roster row's handle — the fallback when a platform returns none. */
  creatorHandle: string;
};

export function newConnectToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isWellFormedConnectToken(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && TOKEN_PATTERN.test(raw);
}

export function hashConnectToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function connectLinkPath(raw: string): string {
  return `/connect/${raw}`;
}

const log = () => createLogger({ context: { call: "connect.token" } });

/** The live binding behind a token row id: not revoked, roster row still there. */
export async function bindingForTokenId(tokenId: string): Promise<ConnectBinding | null> {
  if (!(await connectTablesReady())) return null;
  try {
    const row = await db.creatorConnectToken.findUnique({
      where: { id: tokenId },
      select: { id: true, orgId: true, creatorId: true, revokedAt: true },
    });
    if (!row || row.revokedAt) return null;
    /* orgId AND id, never id alone: a token row names the org it was made in,
       and the creator must still be on that org's roster. */
    const creator = await db.creator.findFirst({
      where: { id: row.creatorId, orgId: row.orgId, deletedAt: null },
      select: { id: true, handle: true },
    });
    if (!creator) return null;
    return {
      tokenId: row.id,
      orgId: row.orgId,
      creatorId: creator.id,
      creatorHandle: creator.handle,
    };
  } catch (err) {
    log().warn("Connect token lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** The binding for a raw token from a /connect/<token> URL, or null. */
export async function resolveConnectToken(raw: string | null | undefined): Promise<ConnectBinding | null> {
  if (!isWellFormedConnectToken(raw)) return null;
  if (!(await connectTablesReady())) return null;
  try {
    const row = await db.creatorConnectToken.findUnique({
      where: { tokenHash: hashConnectToken(raw) },
      select: { id: true },
    });
    return row ? await bindingForTokenId(row.id) : null;
  } catch (err) {
    log().warn("Connect token resolve failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Makes a new link for one roster row and revokes any it already had, so there
 * is only ever one live link per creator per org: "rotate" and "make" are the
 * same act. Returns the raw token — the only time it exists outside the
 * creator's hands — or null when the tables are not there yet.
 */
export async function issueConnectToken(input: {
  orgId: string;
  creatorId: string;
  createdById?: string | null;
}): Promise<{ id: string; token: string; createdAt: Date } | null> {
  if (!(await connectTablesReady())) return null;
  const token = newConnectToken();
  const now = new Date();
  const [, created] = await db.$transaction([
    db.creatorConnectToken.updateMany({
      where: { orgId: input.orgId, creatorId: input.creatorId, revokedAt: null },
      data: { revokedAt: now },
    }),
    db.creatorConnectToken.create({
      data: {
        orgId: input.orgId,
        creatorId: input.creatorId,
        tokenHash: hashConnectToken(token),
        createdById: input.createdById ?? null,
      },
      select: { id: true, createdAt: true },
    }),
  ]);
  return { id: created.id, token, createdAt: created.createdAt };
}

/** Revokes every live link for one roster row. Returns how many were live. */
export async function revokeConnectTokens(input: { orgId: string; creatorId: string }): Promise<number> {
  if (!(await connectTablesReady())) return 0;
  const { count } = await db.creatorConnectToken.updateMany({
    where: { orgId: input.orgId, creatorId: input.creatorId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/** The live link's metadata for one roster row — never the token itself. */
export async function connectTokenStatus(input: {
  orgId: string;
  creatorId: string;
}): Promise<{ id: string; createdAt: Date; usedAt: Date | null } | null> {
  if (!(await connectTablesReady())) return null;
  return db.creatorConnectToken.findFirst({
    where: { orgId: input.orgId, creatorId: input.creatorId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, usedAt: true },
  });
}

/** Records that an account was connected through this link. Never throws. */
export async function markConnectTokenUsed(tokenId: string): Promise<void> {
  if (!(await connectTablesReady())) return;
  try {
    await db.creatorConnectToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
  } catch (err) {
    log().warn("Could not mark connect token used", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/* ── OAuth state ──────────────────────────────────────────────────────────
   `ct.<nonce>.<tokenId>.<mac>`. The nonce keeps each state unique (it is also
   the CSRF value the state cookie must equal); the MAC, keyed with the auth
   secret, is what stops someone who holds their own link from editing the
   tokenId in their own state cookie and landing their account on another
   creator's row. */

const STATE_PREFIX = "ct";

function stateSecret(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || null;
}

function stateMac(secret: string, nonce: string, tokenId: string): string {
  return createHmac("sha256", secret)
    .update(`connect-state:${nonce}:${tokenId}`)
    .digest("base64url");
}

/** A signed OAuth state carrying one token row id, or null with no secret set. */
export function connectState(tokenId: string): string | null {
  const secret = stateSecret();
  if (!secret) return null;
  const nonce = randomBytes(16).toString("hex");
  return `${STATE_PREFIX}.${nonce}.${tokenId}.${stateMac(secret, nonce, tokenId)}`;
}

/** The token row id inside a state this app signed, or null for any other state. */
export function readConnectState(state: string | null | undefined): string | null {
  if (!state || !state.startsWith(`${STATE_PREFIX}.`)) return null;
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [, nonce, tokenId, mac] = parts;
  if (!/^[0-9a-f]{32}$/.test(nonce) || !/^[A-Za-z0-9_-]{1,64}$/.test(tokenId)) return null;
  const secret = stateSecret();
  if (!secret) return null;
  const expected = Buffer.from(stateMac(secret, nonce, tokenId));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return tokenId;
}
