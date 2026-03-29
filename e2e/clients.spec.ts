import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Clients', () => {
  test('loads clients page', async ({ page }) => {
    await page.goto('/clients');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/clients');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar has clients link', async ({ page }) => {
    await page.goto('/clients');
    await waitForMain(page);
    await expect(page.locator('a[href="/clients"]').first()).toBeVisible();
  });
});
