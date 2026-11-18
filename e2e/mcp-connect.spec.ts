import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import { collectPageErrors, unexpectedErrors, expectNoHorizontalScroll, PHONE } from './helpers';

/*
 * The MCP page and the sign-in an MCP client goes through, end to end against
 * the real routes: discovery from the 401, registration, the consent screen,
 * the code exchange, a tool call with the token, refresh rotation, the
 * Connected apps list, and disconnect.
 *
 * The redirect back to the "app" is a loopback address nobody listens on; the
 * browser's request to it is read here, which is where a real client would
 * read the code. (page.route never sees it: a route handler is not called for
 * a request reached through a redirect.)
 */

const CALLBACK = 'http://127.0.0.1:47123/callback';

async function anonymous(baseURL: string | undefined): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

test.describe('MCP page, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the header links to /mcp, which shows the server URL and the steps', async ({ page, baseURL }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');
    await page.getByTestId('nav-mcp').click();
    await expect(page).toHaveURL(/\/mcp$/);
    await expect(page.getByRole('heading', { level: 1, name: /inside claude/i })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('mcp-url')).toHaveText(`${baseURL}/api/mcp`);

    const add = page.getByTestId('mcp-add-to-claude');
    const href = new URL((await add.getAttribute('href')) ?? '');
    expect(href.origin).toBe('https://claude.ai');
    expect(href.searchParams.get('connectorUrl')).toBe(`${baseURL}/api/mcp`);

    await page.getByTestId('mcp-tab-claude-code').click();
    await expect(page.getByTestId('mcp-claude-code-command')).toContainText(`claude mcp add --transport http`);
    await expect(page.getByTestId('mcp-claude-code-command')).toContainText(`${baseURL}/api/mcp`);
    const toolCount = await page.getByTestId('mcp-tools').locator('li').count();
    expect(toolCount).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${toolCount} tools`) })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true }).last()).toBeVisible();
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/mcp');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30000 });
    await expectNoHorizontalScroll(page, '/mcp at 390');
    await expect(page.getByTestId('nav-mcp')).toBeVisible();
    await page.goto('/');
    await expectNoHorizontalScroll(page, '/ at 390 with the MCP link');
  });

  test('the consent screen sends a signed-out visitor to sign in and keeps the request', async ({ page }) => {
    const request = new URLSearchParams({ response_type: 'code', client_id: 'mbo_client_e2e', state: 'keep-me' });
    await page.goto(`/oauth/authorize?${request}`);
    await expect(page).toHaveURL(/\/login\?/, { timeout: 30000 });
    const callback = new URL(page.url()).searchParams.get('callbackUrl') ?? '';
    expect(callback.startsWith('/oauth/authorize?')).toBe(true);
    expect(new URLSearchParams(callback.split('?')[1]).get('state')).toBe('keep-me');
  });

  test('an unauthenticated MCP call points the client at the metadata', async ({ baseURL }) => {
    const api = await anonymous(baseURL);
    const res = await api.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(res.status()).toBe(401);
    const www = res.headers()['www-authenticate'] ?? '';
    expect(www).toContain(`resource_metadata="${baseURL}/.well-known/oauth-protected-resource/api/mcp"`);

    const pr = await (await api.get('/.well-known/oauth-protected-resource/api/mcp')).json();
    expect(pr).toMatchObject({ resource: `${baseURL}/api/mcp`, authorization_servers: [baseURL] });
    const as = await (await api.get('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: baseURL,
      authorization_endpoint: `${baseURL}/oauth/authorize`,
      code_challenge_methods_supported: ['S256'],
    });
    await api.dispose();
  });
});

test.describe('MCP sign-in, signed in', () => {
  test('register, allow, exchange, call a tool, refresh, disconnect', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    const api = await anonymous(baseURL);

    const reg = await api.post('/api/oauth/register', {
      data: { client_name: `E2E client ${Date.now()}`, redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none' },
    });
    expect(reg.status()).toBe(201);
    const { client_id: clientId, client_name: clientName } = await reg.json();

    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(8).toString('hex');
    const authorize = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      scope: 'mcp',
      resource: `${baseURL}/api/mcp`,
    });

    let landed: URL | null = null;
    page.on('request', (r) => {
      if (r.url().startsWith(CALLBACK)) landed = new URL(r.url());
    });
    await page.goto(`/oauth/authorize?${authorize}`);
    await expect(page.getByRole('heading', { name: new RegExp(`Connect ${clientName}`) })).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('oauth-grants')).toBeVisible();
    await page.getByTestId('oauth-allow').click();
    await expect.poll(() => landed?.searchParams.get('code') ?? null, { timeout: 30000 }).not.toBeNull();
    const back = landed as unknown as URL;
    expect(back.searchParams.get('state')).toBe(state);
    expect(back.searchParams.get('iss')).toBe(baseURL);

    const tokenRes = await api.post('/api/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        code: back.searchParams.get('code') as string,
        redirect_uri: CALLBACK,
        client_id: clientId,
        code_verifier: verifier,
        resource: `${baseURL}/api/mcp`,
      },
    });
    expect(tokenRes.status()).toBe(200);
    const tokens = await tokenRes.json();
    expect(tokens).toMatchObject({ token_type: 'Bearer', scope: 'mcp' });

    const replay = await api.post('/api/oauth/token', {
      form: { grant_type: 'authorization_code', code: back.searchParams.get('code') as string, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier },
    });
    expect(replay.status()).toBe(400);

    const call = (token: string) =>
      api.post('/api/mcp', {
        headers: { authorization: `Bearer ${token}` },
        data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_campaigns', arguments: { limit: 1 } } },
      });
    const listed = await call(tokens.access_token);
    expect(listed.status()).toBe(200);
    expect((await listed.json()).result?.isError ?? false).toBe(false);

    const refreshed = await api.post('/api/oauth/token', {
      form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: clientId },
    });
    expect(refreshed.status()).toBe(200);
    const next = await refreshed.json();
    expect((await call(tokens.access_token)).status()).toBe(401);
    expect((await call(next.access_token)).status()).toBe(200);

    await page.goto('/mcp#connected');
    const row = page.locator('.mcp-conn', { hasText: clientName });
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.getByRole('button', { name: 'Disconnect' }).click();
    await expect(row).toHaveCount(0);
    expect((await call(next.access_token)).status()).toBe(401);
    await api.dispose();
  });
});
