import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Activations', () => {
  test('loads activations page', async ({ page }) => {
    await page.goto('/activations');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/activations');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar has activations link', async ({ page }) => {
    await page.goto('/activations');
    await waitForMain(page);
    await expect(page.locator('a[href="/activations"]').first()).toBeVisible();
  });
});
