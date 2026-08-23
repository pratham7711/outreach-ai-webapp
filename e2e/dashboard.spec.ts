import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, expectTextOnPage, navigateAndWait } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/dashboard');
  });

  test('renders page heading', async ({ page }) => {
    await expectHeading(page, 'Dashboard');
  });

  test('shows stat cards', async ({ page }) => {
    // The money side of the product is parked, so there is no payouts tile to
    // assert -- see the note on NAV_SECTIONS in components/NewSidebar.tsx. What
    // the Overview tab always draws is the campaign and creator counts; views
    // and posts appear only once a platform rollup exists.
    // Scoped to main: "Creators" is also a sidebar link, so an unscoped match
    // would pass with no tile on the page at all.
    const main = page.locator('main');
    await expect(main.getByText('Active campaigns').first()).toBeVisible({ timeout: 15000 });
    await expect(main.getByText('Creators').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows recent campaigns from seed data', async ({ page }) => {
    // Recent campaigns live on the Activity tab; Overview is the default.
    await page.getByRole('tab', { name: /activity/i }).click();
    // Seed has campaigns like "LEAK IT (BTS)", "FUJI KAZE"
    await expect(page.getByText(/LEAK IT/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('sidebar has navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /campaigns/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /creators/i }).first()).toBeVisible({ timeout: 10000 });
    // Payouts is deliberately unlinked while payments are parked -- the route
    // and its tables stay, but nothing in the nav points at it.
    await expect(page.getByRole('link', { name: /activations/i }).first()).toBeVisible({ timeout: 10000 });
  });
});
