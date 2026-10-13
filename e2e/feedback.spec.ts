import { test, expect, type Page } from '@playwright/test';
import { waitForMain } from './helpers';

/**
 * The Feedback button, from both ends: the person who presses it (an agency
 * user on a dashboard page) and the platform operator who reads it at
 * /platform/feedback. Signed-out pages do not offer it.
 *
 * Every report must arrive with a screenshot -- that is the feature -- so each
 * test fetches the stored image back and checks it is a real JPEG, not just
 * that the dialog said "sent".
 *
 * The default session is admin@demo.com, which PLATFORM_ADMIN_EMAILS lists in
 * .env.local and in CI, so the same session is both sender and operator.
 */

type InboxRow = { id: string; message: string | null; surface: string; hasScreenshot: boolean; screenshotError: string | null; orgName: string | null; userEmail: string | null; fromLink: boolean; pageUrl: string };

async function sendFeedback(page: Page, message: string) {
  const button = page.getByRole('button', { name: 'Send feedback about this page' });
  await expect(button).toBeVisible({ timeout: 20000 });
  await button.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Send feedback', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  const preview = dialog.getByRole('img', { name: /Screenshot of this page/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(dialog.getByText('A screenshot of this page is sent with your feedback.')).toBeVisible();

  await dialog.getByLabel(/What went wrong/).fill(message);
  const posted = page.waitForResponse((r) => r.url().endsWith('/api/feedback') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Send feedback' }).click();
  const res = await posted;
  expect(res.status()).toBe(201);
  await expect(page.getByText(/Thanks — we.ve got it/)).toBeVisible();
}

async function findInInbox(page: Page, marker: string): Promise<InboxRow> {
  const res = await page.request.get('/api/platform/feedback?status=all');
  expect(res.status()).toBe(200);
  const inbox = (await res.json()) as { ready: boolean; rows: InboxRow[] };
  expect(inbox.ready).toBe(true);
  const row = inbox.rows.find((r) => r.message === marker);
  expect(row, `feedback "${marker}" in the operator inbox`).toBeTruthy();
  return row!;
}

async function expectStoredJpeg(page: Page, id: string) {
  const shot = await page.request.get(`/api/platform/feedback/${id}/screenshot`);
  expect(shot.status()).toBe(200);
  expect(shot.headers()['content-type']).toBe('image/jpeg');
  const bytes = await shot.body();
  expect(bytes.length).toBeGreaterThan(5000);
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
}

test.describe('Feedback', () => {
  test('agency user sends feedback with a screenshot; the operator sees and resolves it', async ({ page }) => {
    const marker = `e2e feedback dashboard ${Date.now()}`;
    await page.goto('/campaigns');
    await page.waitForLoadState('networkidle');
    await sendFeedback(page, marker);

    const row = await findInInbox(page, marker);
    expect(row.surface).toBe('dashboard');
    expect(row.userEmail).toBe('admin@demo.com');
    expect(row.hasScreenshot).toBe(true);
    expect(row.screenshotError).toBeNull();
    expect(new URL(row.pageUrl).pathname).toBe('/campaigns');
    await expectStoredJpeg(page, row.id);

    await page.goto('/platform/feedback');
    await waitForMain(page);
    // Briefly duplicated while the outgoing and incoming trees overlap during
    // the page-enter transition, which trips strict mode (as in audit-log.spec).
    const item = page.getByTestId('feedback-row').filter({ hasText: marker }).first();
    await expect(item).toBeVisible({ timeout: 20000 });
    await expect(item.getByText('Agency app')).toBeVisible();
    const thumb = item.getByRole('img', { name: 'Screenshot sent with this feedback' });
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);

    await item.getByRole('button', { name: 'Mark resolved' }).click();
    await expect(page.getByTestId('feedback-row').filter({ hasText: marker })).toHaveCount(0, { timeout: 15000 });
  });

  /* The button left the signed-out pages on purpose (2026-10-13): a brand
     opening a report link is not who it asks, and as a floating pill it sat
     over the report's own controls. The API still accepts a link-token report,
     which the next test covers from the refusing side. */
  test('a signed-out visitor on a share link is not offered Feedback', async ({ browser, page }) => {
    const share = await page.request.post('/api/campaigns/camp-1/share');
    let token: string | null = share.ok() ? ((await share.json())?.link?.token ?? null) : null;
    if (!token) {
      const existing = await page.request.get('/api/campaigns/camp-1/share');
      token = existing.ok() ? ((await existing.json())?.link?.token ?? null) : null;
    }
    expect(token, 'a public share link for camp-1').toBeTruthy();

    const client = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const clientPage = await client.newPage();
      await clientPage.goto(`/share/${token}`);
      await clientPage.waitForLoadState('networkidle');
      // The report itself rendered, so an absent button is not an absent page.
      await expect(clientPage.getByRole('heading').first()).toBeVisible({ timeout: 20000 });
      await expect(clientPage.getByRole('button', { name: 'Send feedback about this page' })).toHaveCount(0);
    } finally {
      await client.close();
    }
  });

  test('no session and no live link is refused', async ({ browser }) => {
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const res = await stranger.request.post('/api/feedback', {
        data: { surface: 'share', linkToken: 'not-a-real-token', pageUrl: 'http://localhost/share/x', message: 'hi' },
      });
      expect(res.status()).toBe(401);
      const inbox = await stranger.request.get('/api/platform/feedback');
      expect(inbox.status()).toBe(404);
    } finally {
      await stranger.close();
    }
  });
});
