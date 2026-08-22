import { test, expect } from '@playwright/test';
import { waitForMain, navigateAndWait } from './helpers';

const ADMIN_PAGES = [
  '/dashboard',
  '/campaigns',
  '/creators',
  '/clients',
  '/payouts',
  '/activations',
  '/lists',
  '/discovery',
  '/calendar',
  '/connections',
  '/deadlines',
  '/financial-reports',
  '/settings',
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
    await navigateAndWait(page, '/dashboard');
    // Check core sidebar links exist
    // Payouts is deliberately absent: the money side is parked, so Payouts,
    // Requests, Recipients and Financials keep their routes but are unlinked
    // (see the note at the top of NewSidebar.tsx).
    const sidebarLinks = ['Campaigns', 'Creators', 'Clients'];
    for (const linkText of sidebarLinks) {
      await expect(page.getByRole('link', { name: new RegExp(linkText, 'i') }).first()).toBeVisible({ timeout: 10000 });
    }
  });
});
