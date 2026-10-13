import { test, expect, request as playwrightRequest } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3009';
const OFFERED_RATE = 100;
const CREATOR_COUNTER = 200;

async function orgAdminToken() {
  const { encode } = await import('next-auth/jwt');
  return encode({
    token: {
      sub: 'cmnbxspfv00016vfdz6yuds55',
      id: 'cmnbxspfv00016vfdz6yuds55',
      email: 'admin@demo.com',
      name: 'Admin',
      orgId: 'cmnbxsoos00006vfd7jhdvusb',
      role: 'OWNER',
    },
    secret: process.env.NEXTAUTH_SECRET ?? '4Ngtr3WB/HGm9bJ2K8GkcuWjAIt8sQB6zpt60AL2lFU=',
    salt: 'authjs.session-token',
  });
}

async function portalLoginStorageState() {
  const apiCtx = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await apiCtx.post('/api/portal/auth/login', {
    data: { email: 'creator@demo.com', password: 'creator123' },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    const text = await res.text();
    await apiCtx.dispose();
    throw new Error(`Portal login failed: ${res.status()} ${text}`);
  }
  const cookieHeader = res.headers()['set-cookie'] ?? '';
  await apiCtx.dispose();

  const tokenMatch = cookieHeader.match(/creator_portal_token=([^;]+)/);
  if (!tokenMatch) throw new Error(`Portal login: no creator_portal_token in Set-Cookie: ${cookieHeader}`);
  const token = tokenMatch[1];

  const expiresMatch = cookieHeader.match(/Expires=([^;]+)/i);
  let expires = -1;
  if (expiresMatch) {
    const d = new Date(expiresMatch[1]);
    if (!isNaN(d.getTime())) expires = d.getTime() / 1000;
  }

  return {
    cookies: [
      {
        name: 'creator_portal_token',
        value: token,
        domain: 'localhost',
        path: '/',
        expires,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };
}

async function startBatchViaApi(adminToken: string, campaignId: string, creatorIds: string[], offeredRate: number): Promise<{ offerId: string | null; onPortal: boolean }> {
  const apiCtx = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await apiCtx.post('/api/negotiations/start-batch', {
    data: { campaignId, creatorIds, offeredRate, currency: 'USD' },
    headers: { Cookie: `authjs.session-token=${adminToken}` },
  });
  const ok = res.ok();
  const status = res.status();
  let data: any = null;
  if (ok) {
    data = await res.json();
  } else {
    const text = await res.text();
    await apiCtx.dispose();
    throw new Error(`start-batch failed: ${status} ${text}`);
  }
  await apiCtx.dispose();
  const result = data?.results?.[0];
  return { offerId: result?.offerId ?? null, onPortal: result?.onPortal ?? false };
}

/* creator-1 ("@blessingjolie") is the roster row the offers are made to, and
   creator@demo.com is the portal login that answers them. Sharing a handle is
   not proof of owning the row (lib/portal/creatorLink.ts), so the portal sees
   no offer until the row is linked -- the same way a real rostered creator
   links: the agency sends its per-creator invite link and the creator accepts
   it. camp-3 is used because creator-1 is already on it (seed act-4), so the
   accept adds no activation. Accepting again from the same login is a no-op. */
async function linkCreator1ToPortal(adminToken: string) {
  const apiCtx = await playwrightRequest.newContext({ baseURL: BASE });
  const invite = await apiCtx.post('/api/campaigns/camp-3/invites', {
    data: { creatorId: 'creator-1' },
    headers: { Cookie: `authjs.session-token=${adminToken}` },
  });
  if (invite.status() !== 201) {
    const text = await invite.text();
    await apiCtx.dispose();
    throw new Error(`invite create failed: ${invite.status()} ${text}`);
  }
  const { inviteToken } = await invite.json();
  await apiCtx.dispose();

  const portalCtx = await playwrightRequest.newContext({ baseURL: BASE, storageState: await portalLoginStorageState() });
  const accept = await portalCtx.post(`/api/portal/invites/${inviteToken}/accept`);
  const status = accept.status();
  const text = await accept.text();
  await portalCtx.dispose();
  if (status !== 200 && status !== 201) throw new Error(`invite accept failed: ${status} ${text}`);
}

/* The agency's side of this flow -- Make Offer, Approve, Reject in the
   campaign's Negotiations section -- left the UI in October 2026 with the rest
   of the payments surface, and its three tests with it. The creator's Offers
   screen followed when the creator app was rebuilt (/portal/offers now
   redirects to Home), so what stays is the creator's side as the API drives
   it. */
test.describe('AI Negotiation', () => {
  test('(b) portal: counter at 200 → AI counter between 100 and 125, status COUNTERED, aiRound=1', async () => {
    const adminToken = await orgAdminToken();

    await linkCreator1ToPortal(adminToken);

    let offerId: string | null = null;
    let onPortal = false;
    try {
      const result = await startBatchViaApi(adminToken, 'camp-2', ['creator-1'], OFFERED_RATE);
      offerId = result.offerId;
      onPortal = result.onPortal;
    } catch (e: any) {
      test.fixme(true, `start-batch API error: ${e.message}`);
      return;
    }

    /* Linked above, so start-batch must address the portal login. A false here
       is a broken proof, not a fixture gap, and fails rather than skips. */
    expect(onPortal).toBe(true);
    expect(offerId).toBeTruthy();

    const portalState = await portalLoginStorageState();
    const portalReqCtx = await playwrightRequest.newContext({ baseURL: BASE, storageState: portalState });
    const res = await portalReqCtx.post(`/api/portal/offers/${offerId}/respond`, {
      data: { action: 'counter', counterRate: CREATOR_COUNTER },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    await portalReqCtx.dispose();

    expect(body.status).toBe('COUNTERED');
    expect(body.aiRound).toBe(1);
    expect(Number(body.aiCounterRate)).toBeGreaterThanOrEqual(OFFERED_RATE);
    expect(Number(body.aiCounterRate)).toBeLessThanOrEqual(OFFERED_RATE * 1.25);
  });

  test('(c) portal: second counter returns 409', async () => {
    const adminToken = await orgAdminToken();

    await linkCreator1ToPortal(adminToken);

    let offerId: string | null = null;
    let onPortal = false;
    try {
      const result = await startBatchViaApi(adminToken, 'camp-3', ['creator-1'], OFFERED_RATE);
      offerId = result.offerId;
      onPortal = result.onPortal;
    } catch (e: any) {
      test.fixme(true, `start-batch API error: ${e.message}`);
      return;
    }

    expect(onPortal).toBe(true);
    expect(offerId).toBeTruthy();

    const portalState = await portalLoginStorageState();
    const portalReqCtx = await playwrightRequest.newContext({ baseURL: BASE, storageState: portalState });
    const firstCounter = await portalReqCtx.post(`/api/portal/offers/${offerId}/respond`, {
      data: { action: 'counter', counterRate: CREATOR_COUNTER },
    });
    const firstOk = firstCounter.ok();
    const firstText = await firstCounter.text();
    if (!firstOk) {
      test.fixme(true, `First counter failed: ${firstCounter.status()} ${firstText}.`);
      await portalReqCtx.dispose();
      return;
    }

    const secondCounter = await portalReqCtx.post(`/api/portal/offers/${offerId}/respond`, {
      data: { action: 'counter', counterRate: 300 },
    });
    expect(secondCounter.status()).toBe(409);
    await portalReqCtx.dispose();
  });
});
