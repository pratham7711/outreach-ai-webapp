import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

const PAGES = [
  { name: 'Campaigns', href: '/campaigns' },
  { name: 'Creators', href: '/creators' },
  { name: 'Payouts', href: '/payouts' },
  { name: 'Clients', href: '/clients' },
  { name: 'Lists', href: '/lists' },
  { name: 'Activations', href: '/activations' },
];

test.describe('Navigation', () => {
  test('sidebar renders stable nav items', async ({ page }) => {
    await page.goto('/settings');
    await waitForMain(page);

    await expect(page.locator('a[href="/settings"]').first()).toBeVisible();
    await expect(page.locator('a[href="/settings/billing"]').first()).toBeVisible();
    await expect(page.locator('a[href="/settings/team"]').first()).toBeVisible();
  });

  test('can navigate between settings pages via sidebar', async ({ page }) => {
    await page.goto('/settings');
    await waitForMain(page);
    await page.locator('a[href="/settings/billing"]').first().click();
    await expect(page).toHaveURL(/\/settings\/billing/, { timeout: 15000 });
  });

  test('all pages load without redirecting to login', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(p.href);
      await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
    }
  });

  test('all pages have main content area', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(p.href);
      await waitForMain(page);
      await expect(page.locator('main').first()).toBeVisible();
    }
  });
});
