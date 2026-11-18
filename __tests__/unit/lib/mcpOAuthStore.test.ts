/**
 * @jest-environment node
 *
 * The token endpoint's two grants against a mocked database: a code is spent
 * on its first presentation, every binding (client, redirect, PKCE, account)
 * is checked after it is spent, and a refresh token that comes back after
 * rotation ends every token that client holds for that person.
 */
import { createHash } from "crypto";

const codeUpdateMany = jest.fn();
const codeFindUnique = jest.fn();
const tokenCreate = jest.fn();
const tokenFindUnique = jest.fn();
const tokenUpdateMany = jest.fn();
const tokenUpdate = jest.fn();
const userFindUnique = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    mcpOAuthCode: { updateMany: (...a: unknown[]) => codeUpdateMany(...a), findUnique: (...a: unknown[]) => codeFindUnique(...a) },
    mcpOAuthToken: {
      create: (...a: unknown[]) => tokenCreate(...a),
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      updateMany: (...a: unknown[]) => tokenUpdateMany(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}));

import { hashSecret, type ResolvedClient } from "@/lib/oauth/mcpOAuth";
import { authenticateAccessToken, exchangeAuthorizationCode, refreshTokens } from "@/lib/oauth/mcpOAuthStore";

const ORIGIN = "https://campaign.example.com";
const verifier = "v".repeat(50);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const client: ResolvedClient = {
  clientId: "mbo_client_1",
  name: "Claude",
  clientUri: null,
  logoUri: null,
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
  tokenEndpointAuthMethod: "none",
  clientSecretHash: null,
  kind: "registered",
};
const codeRow = {
  clientId: client.clientId,
  userId: "u1",
  orgId: "o1",
  redirectUri: client.redirectUris[0],
  codeChallenge: challenge,
  scope: "mcp",
  resource: `${ORIGIN}/api/mcp`,
};
const activeUser = { id: "u1", orgId: "o1", email: "a@b.com", role: "MEMBER", campaignScope: "ASSIGNED", isActive: true };

const exchange = (over: Partial<Parameters<typeof exchangeAuthorizationCode>[0]> = {}) =>
  exchangeAuthorizationCode({
    code: "mbo_ac_x",
    client,
    redirectUri: client.redirectUris[0],
    codeVerifier: verifier,
    resource: `${ORIGIN}/api/mcp`,
    origin: ORIGIN,
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  codeUpdateMany.mockResolvedValue({ count: 1 });
  codeFindUnique.mockResolvedValue(codeRow);
  userFindUnique.mockResolvedValue(activeUser);
  tokenCreate.mockResolvedValue({ id: "t-new" });
  tokenUpdateMany.mockResolvedValue({ count: 1 });
  tokenUpdate.mockResolvedValue({});
});

describe("authorization_code", () => {
  it("issues an access and a refresh token, storing only their hashes", async () => {
    const out = await exchange();
    expect(out).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "mcp" });
    const tokens = out as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toMatch(/^mbo_at_/);
    expect(tokens.refresh_token).toMatch(/^mbo_rt_/);
    const data = tokenCreate.mock.calls[0][0].data;
    expect(data.accessTokenHash).toBe(hashSecret(tokens.access_token));
    expect(data.refreshTokenHash).toBe(hashSecret(tokens.refresh_token));
    expect(JSON.stringify(data)).not.toContain(tokens.access_token);
    expect(data).toMatchObject({ userId: "u1", orgId: "o1", clientId: client.clientId, clientName: "Claude" });
  });

  it("spends the code before checking it, so a used or expired code issues nothing", async () => {
    codeUpdateMany.mockResolvedValue({ count: 0 });
    expect(await exchange()).toMatchObject({ error: "invalid_grant" });
    expect(codeUpdateMany.mock.calls[0][0].where).toMatchObject({ codeHash: hashSecret("mbo_ac_x"), usedAt: null });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["another client", { client: { ...client, clientId: "mbo_client_2" } }],
    ["another redirect_uri", { redirectUri: "https://claude.ai/other" }],
    ["a wrong verifier", { codeVerifier: "w".repeat(50) }],
    ["no verifier", { codeVerifier: null }],
  ])("refuses %s", async (_label, over) => {
    expect(await exchange(over as never)).toMatchObject({ error: "invalid_grant" });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("refuses another resource", async () => {
    expect(await exchange({ resource: "https://other.example.com/api/mcp" })).toMatchObject({ error: "invalid_target" });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("refuses when the account was deactivated or moved org since Allow", async () => {
    userFindUnique.mockResolvedValue({ ...activeUser, isActive: false });
    expect(await exchange()).toMatchObject({ error: "invalid_grant" });
    userFindUnique.mockResolvedValue({ ...activeUser, orgId: "o2" });
    expect(await exchange()).toMatchObject({ error: "invalid_grant" });
    expect(tokenCreate).not.toHaveBeenCalled();
  });
});

describe("refresh_token", () => {
  const row = {
    id: "t1",
    clientId: client.clientId,
    clientName: "Claude",
    userId: "u1",
    orgId: "o1",
    scope: "mcp",
    resource: null,
    revokedAt: null as Date | null,
    refreshExpiresAt: new Date(Date.now() + 86_400_000),
  };

  it("rotates: the old pair is revoked and a new one issued", async () => {
    tokenFindUnique.mockResolvedValue(row);
    const out = await refreshTokens({ refreshToken: "mbo_rt_old", client });
    expect(out).toMatchObject({ token_type: "Bearer" });
    expect(tokenUpdateMany.mock.calls[0][0]).toMatchObject({ where: { id: "t1", revokedAt: null } });
    expect(tokenCreate).toHaveBeenCalledTimes(1);
  });

  it("treats a rotated-away token coming back as theft and ends that client's tokens for the person", async () => {
    tokenFindUnique.mockResolvedValue({ ...row, revokedAt: new Date() });
    expect(await refreshTokens({ refreshToken: "mbo_rt_old", client })).toMatchObject({ error: "invalid_grant" });
    expect(tokenUpdateMany.mock.calls[0][0].where).toEqual({ userId: "u1", clientId: client.clientId, revokedAt: null });
    expect(tokenCreate).not.toHaveBeenCalled();
  });

  it("refuses an expired token, another client's token, and a lost race", async () => {
    tokenFindUnique.mockResolvedValue({ ...row, refreshExpiresAt: new Date(Date.now() - 1) });
    expect(await refreshTokens({ refreshToken: "mbo_rt_old", client })).toMatchObject({ error: "invalid_grant" });
    tokenFindUnique.mockResolvedValue({ ...row, clientId: "mbo_client_2" });
    expect(await refreshTokens({ refreshToken: "mbo_rt_old", client })).toMatchObject({ error: "invalid_grant" });
    tokenFindUnique.mockResolvedValue(row);
    tokenUpdateMany.mockResolvedValue({ count: 0 });
    expect(await refreshTokens({ refreshToken: "mbo_rt_old", client })).toMatchObject({ error: "invalid_grant" });
    expect(tokenCreate).not.toHaveBeenCalled();
  });
});

describe("access tokens on /api/mcp", () => {
  const live = { id: "t1", userId: "u1", orgId: "o1", revokedAt: null, accessExpiresAt: new Date(Date.now() + 60_000), lastUsedAt: new Date() };

  it("act as the person, with their role and campaign scope read now", async () => {
    tokenFindUnique.mockResolvedValue(live);
    expect(await authenticateAccessToken("mbo_at_x")).toEqual({
      ok: true,
      auth: { orgId: "o1", userId: "u1", actorEmail: "a@b.com", actorType: "user", role: "MEMBER", campaignScope: "ASSIGNED" },
    });
  });

  it("refuse a revoked, expired or unknown token, or a deactivated person", async () => {
    tokenFindUnique.mockResolvedValue({ ...live, revokedAt: new Date() });
    expect(await authenticateAccessToken("mbo_at_x")).toEqual({ ok: false, reason: "invalid" });
    tokenFindUnique.mockResolvedValue({ ...live, accessExpiresAt: new Date(Date.now() - 1) });
    expect(await authenticateAccessToken("mbo_at_x")).toEqual({ ok: false, reason: "invalid" });
    tokenFindUnique.mockResolvedValue(null);
    expect(await authenticateAccessToken("mbo_at_x")).toEqual({ ok: false, reason: "invalid" });
    tokenFindUnique.mockResolvedValue(live);
    userFindUnique.mockResolvedValue({ ...activeUser, isActive: false });
    expect(await authenticateAccessToken("mbo_at_x")).toEqual({ ok: false, reason: "invalid" });
  });
});
