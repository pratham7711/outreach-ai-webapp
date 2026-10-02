import { test, expect } from '@playwright/test';
import { waitForMain, navigateAndWait } from './helpers';

const ADMIN_PAGES = [
  '/dashboard',
  '/campaigns',
  '/creators',
  '/lists',
  '/trackers',
  '/songs',
  '/calendar',
  '/analytics',
  '/settings',
  '/admin',
  '/plans',
];

/* Parked in October 2026 (NewSidebar.tsx, next.config.ts). Each must answer a
   temporary redirect to its kept page -- never a 404, never the old page. */
const PARKED: Array<[string, string]> = [
  ['/activations', '/campaigns'],
  ['/deadlines', '/campaigns'],
  ['/clients', '/campaigns'],
  ['/clients/any-id', '/campaigns'],
  ['/discovery', '/creators'],
  ['/connections', '/settings'],
  ['/payouts', '/campaigns'],
  ['/requests', '/campaigns'],
  ['/recipients', '/campaigns'],
  ['/financial-reports', '/campaigns'],
  ['/campaigns/self-serve', '/campaigns'],
  ['/settings/billing', '/settings'],
  ['/inbox', '/campaigns'],
  ['/fan-pages', '/campaigns'],
  ['/media-kits', '/creators'],
  ['/reports', '/campaigns'],
];

test.describe('Navigation', () => {
  test('all admin pages load without error', async ({ page }) => {
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await waitForMain(page, 30000);
      // Verify we're not redirected to login
      await expect(page).not.toHaveURL(/\/login/);
      // Verify main content area exists
      await expect(page.locator('main').first()).toBeVisible();
    }
  });

  test('sidebar navigation links are present', async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
    const sidebar = page.locator('nav, aside').first();
    for (const linkText of ['Campaigns', 'Creator Roster', 'Lists', 'Trackers']) {
      await expect(sidebar.getByRole('link', { name: new RegExp(linkText, 'i') }).first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('parked pages are not in the sidebar', async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
    for (const href of ['/activations', '/deadlines', '/clients', '/discovery', '/connections', '/settings/billing', '/payouts']) {
      await expect(page.locator(`aside a[href="${href}"], nav a[href="${href}"]`)).toHaveCount(0);
    }
  });

  test('parked pages redirect temporarily to the page that replaced them', async ({ page }) => {
    for (const [from, to] of PARKED) {
      const res = await page.request.get(from, { maxRedirects: 0 });
      expect([from, res.status()]).toEqual([from, 307]);
      expect([from, new URL(res.headers()['location'], 'http://x').pathname]).toEqual([from, to]);
    }
  });
});
