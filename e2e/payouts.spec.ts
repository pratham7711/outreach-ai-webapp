import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Payouts', () => {
  test('loads payouts page', async ({ page }) => {
    await page.goto('/payouts');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/payouts');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar has payouts link', async ({ page }) => {
    await page.goto('/payouts');
    await waitForMain(page);
    await expect(page.locator('a[href="/payouts"]').first()).toBeVisible();
  });
});
