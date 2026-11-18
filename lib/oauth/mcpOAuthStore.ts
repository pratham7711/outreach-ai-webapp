import type { AuthResult } from "@/lib/authenticate";
import type { UserRole } from "@/lib/rbac";
import {
  ACCESS_TOKEN_TTL_S,
  CODE_TTL_S,
  REFRESH_TOKEN_TTL_S,
  fetchMetadataDocumentClient,
  hashSecret,
  isMetadataDocumentClientId,
  newAccessToken,
  newAuthorizationCode,
  newRefreshToken,
  resourceMatches,
  verifyPkce,
  type ResolvedClient,
} from "./mcpOAuth";
import { isMissingMcpOAuthTable } from "./mcpOAuthDdl";

/**
 * The OAuth tables, behind the few operations the routes need. The client is
 * imported on first use so the pure module stays testable without a database.
 */

async function getDb() {
  return (await import("@/lib/db")).db;
}

export class OAuthUnavailable extends Error {}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isMissingMcpOAuthTable(e)) throw new OAuthUnavailable("MCP OAuth tables are not created yet");
    throw e;
  }
}

export async function resolveClient(clientId: string | null | undefined): Promise<ResolvedClient | null> {
  if (!clientId || clientId.length > 2000) return null;
  if (isMetadataDocumentClientId(clientId)) return fetchMetadataDocumentClient(clientId);
  const db = await getDb();
  const row = await guard(() => db.mcpOAuthClient.findUnique({ where: { clientId } }));
  if (!row) return null;
  const method = row.tokenEndpointAuthMethod;
  return {
    clientId: row.clientId,
    name: row.name,
    clientUri: row.clientUri,
    logoUri: row.logoUri,
    redirectUris: row.redirectUris,
    tokenEndpointAuthMethod:
      method === "client_secret_post" || method === "client_secret_basic" ? method : "none",
    clientSecretHash: row.clientSecretHash,
    kind: "registered",
  };
}

export async function registerClient(input: {
  clientId: string;
  clientSecretHash: string | null;
  name: string | null;
  clientUri: string | null;
  logoUri: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
}) {
  const db = await getDb();
  return guard(() => db.mcpOAuthClient.create({ data: input }));
}

export async function createAuthorizationCode(input: {
  clientId: string;
  userId: string;
  orgId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const db = await getDb();
  const code = newAuthorizationCode();
  const now = Date.now();
  await guard(async () => {
    /* Expired codes are dead weight; clearing them here keeps the table to the
       last ten minutes of sign-ins without a cron. */
    await db.mcpOAuthCode.deleteMany({ where: { expiresAt: { lt: new Date(now - 60 * 60 * 1000) } } });
    await db.mcpOAuthCode.create({
      data: {
        ...input,
        codeHash: hashSecret(code),
        expiresAt: new Date(now + CODE_TTL_S * 1000),
      },
    });
  });
  return code;
}

export type IssuedTokens = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type TokenFailure = { error: "invalid_grant" | "invalid_client" | "invalid_target"; description: string };

async function activeUser(userId: string, orgId: string) {
  const db = await getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, orgId: true, email: true, role: true, campaignScope: true, isActive: true },
  });
  return user && user.isActive && user.orgId === orgId ? user : null;
}

async function issue(input: {
  clientId: string;
  clientName: string | null;
  userId: string;
  orgId: string;
  scope: string;
  resource: string | null;
}): Promise<{ tokens: IssuedTokens; id: string }> {
  const db = await getDb();
  const access = newAccessToken();
  const refresh = newRefreshToken();
  const now = Date.now();
  const row = await guard(() =>
    db.mcpOAuthToken.create({
      data: {
        ...input,
        accessTokenHash: hashSecret(access),
        accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
        refreshTokenHash: hashSecret(refresh),
        refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000),
      },
      select: { id: true },
    }),
  );
  return {
    id: row.id,
    tokens: {
      access_token: access,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refresh,
      scope: input.scope,
    },
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string | null;
  client: ResolvedClient;
  redirectUri: string | null;
  codeVerifier: string | null;
  resource: string | null;
  origin: string;
}): Promise<IssuedTokens | TokenFailure> {
  if (!input.code) return { error: "invalid_grant", description: "code is required" };
  const db = await getDb();
  const codeHash = hashSecret(input.code);
  const now = new Date();
  /* Claimed before it is checked: a code is spent by its first presentation,
     right or wrong, so a guess cannot be retried against the same code. */
  const claimed = await guard(() =>
    db.mcpOAuthCode.updateMany({
      where: { codeHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    }),
  );
  if (claimed.count !== 1) return { error: "invalid_grant", description: "The code is invalid, expired or already used." };
  const code = await db.mcpOAuthCode.findUnique({ where: { codeHash } });
  if (!code) return { error: "invalid_grant", description: "The code is invalid." };
  if (code.clientId !== input.client.clientId) return { error: "invalid_grant", description: "The code was issued to another client." };
  if (input.redirectUri !== code.redirectUri) return { error: "invalid_grant", description: "redirect_uri does not match the authorization request." };
  if (!verifyPkce(input.codeVerifier, code.codeChallenge)) return { error: "invalid_grant", description: "code_verifier does not match the code challenge." };
  if (input.resource && !resourceMatches(input.resource, input.origin)) return { error: "invalid_target", description: "resource must be this MCP endpoint." };
  const user = await activeUser(code.userId, code.orgId);
  if (!user) return { error: "invalid_grant", description: "The account that approved this is no longer active." };
  const { tokens } = await issue({
    clientId: code.clientId,
    clientName: input.client.name,
    userId: code.userId,
    orgId: code.orgId,
    scope: code.scope,
    resource: code.resource,
  });
  return tokens;
}

export async function refreshTokens(input: {
  refreshToken: string | null;
  client: ResolvedClient;
}): Promise<IssuedTokens | TokenFailure> {
  if (!input.refreshToken) return { error: "invalid_grant", description: "refresh_token is required" };
  const db = await getDb();
  const refreshTokenHash = hashSecret(input.refreshToken);
  const row = await guard(() => db.mcpOAuthToken.findUnique({ where: { refreshTokenHash } }));
  if (!row || row.clientId !== input.client.clientId) return { error: "invalid_grant", description: "The refresh token is invalid." };
  if (row.revokedAt) {
    /* A rotated-away refresh token coming back means two parties hold it.
       Ending every token this client holds for this person is the safe answer. */
    await db.mcpOAuthToken.updateMany({
      where: { userId: row.userId, clientId: row.clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { error: "invalid_grant", description: "The refresh token was already used." };
  }
  if (!row.refreshExpiresAt || row.refreshExpiresAt <= new Date()) return { error: "invalid_grant", description: "The refresh token has expired." };
  const user = await activeUser(row.userId, row.orgId);
  if (!user) return { error: "invalid_grant", description: "The account that approved this is no longer active." };
  const revoked = await db.mcpOAuthToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) return { error: "invalid_grant", description: "The refresh token was already used." };
  const { tokens } = await issue({
    clientId: row.clientId,
    clientName: row.clientName ?? input.client.name,
    userId: row.userId,
    orgId: row.orgId,
    scope: row.scope,
    resource: row.resource,
  });
  return tokens;
}

/** RFC 7009: revoke an access or refresh token. Unknown tokens are not an error. */
export async function revokeToken(token: string | null, clientId: string | null): Promise<void> {
  if (!token) return;
  const db = await getDb();
  const hash = hashSecret(token);
  await guard(() =>
    db.mcpOAuthToken.updateMany({
      where: {
        OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }],
        ...(clientId ? { clientId } : {}),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
  );
}

export type AccessTokenCheck = { ok: true; auth: AuthResult } | { ok: false; reason: "invalid" | "unavailable" };

const LAST_USED_GRANULARITY_MS = 5 * 60 * 1000;

/** The person an access token acts for, read fresh: a deactivated user or a changed role takes effect at once. */
export async function authenticateAccessToken(accessToken: string): Promise<AccessTokenCheck> {
  const db = await getDb();
  let row;
  try {
    row = await db.mcpOAuthToken.findUnique({
      where: { accessTokenHash: hashSecret(accessToken) },
      select: { id: true, userId: true, orgId: true, revokedAt: true, accessExpiresAt: true, lastUsedAt: true },
    });
  } catch (e) {
    if (isMissingMcpOAuthTable(e)) return { ok: false, reason: "unavailable" };
    throw e;
  }
  if (!row || row.revokedAt || row.accessExpiresAt <= new Date()) return { ok: false, reason: "invalid" };
  const user = await activeUser(row.userId, row.orgId);
  if (!user) return { ok: false, reason: "invalid" };
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    db.mcpOAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  }
  return {
    ok: true,
    auth: {
      orgId: user.orgId,
      userId: user.id,
      actorEmail: user.email,
      actorType: "user",
      role: user.role as UserRole,
      campaignScope: user.campaignScope === "ASSIGNED" ? "ASSIGNED" : "ALL",
    },
  };
}

export type McpConnection = {
  clientId: string;
  name: string;
  connectedAt: string;
  lastUsedAt: string | null;
};

/** The apps a person has connected, one row per client, newest first. */
export async function listConnections(userId: string): Promise<McpConnection[] | null> {
  const db = await getDb();
  let rows;
  try {
    rows = await db.mcpOAuthToken.findMany({
      where: { userId, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
      select: { clientId: true, clientName: true, createdAt: true, lastUsedAt: true },
      orderBy: { createdAt: "desc" },
    });
  } catch (e) {
    if (isMissingMcpOAuthTable(e)) return null;
    throw e;
  }
  const byClient = new Map<string, McpConnection>();
  for (const r of rows) {
    const prev = byClient.get(r.clientId);
    const used = r.lastUsedAt?.toISOString() ?? null;
    if (!prev) {
      byClient.set(r.clientId, {
        clientId: r.clientId,
        name: r.clientName ?? r.clientId,
        connectedAt: r.createdAt.toISOString(),
        lastUsedAt: used,
      });
    } else if (used && (!prev.lastUsedAt || used > prev.lastUsedAt)) {
      prev.lastUsedAt = used;
    }
  }
  return [...byClient.values()];
}

export async function disconnect(userId: string, clientId: string): Promise<number> {
  const db = await getDb();
  const { count } = await guard(() =>
    db.mcpOAuthToken.updateMany({ where: { userId, clientId, revokedAt: null }, data: { revokedAt: new Date() } }),
  );
  return count;
}
