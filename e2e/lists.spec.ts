import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Creator Lists', () => {
  test('loads lists page', async ({ page }) => {
    await page.goto('/lists');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/lists');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar has lists link', async ({ page }) => {
    await page.goto('/lists');
    await waitForMain(page);
    await expect(page.locator('a[href="/lists"]').first()).toBeVisible();
  });
});
