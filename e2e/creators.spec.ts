import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Creators', () => {
  test('loads creators page', async ({ page }) => {
    await page.goto('/creators');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/creators');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar has creators link', async ({ page }) => {
    await page.goto('/creators');
    await waitForMain(page);
    await expect(page.locator('a[href="/creators"]').first()).toBeVisible();
  });
});
