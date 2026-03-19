import { test, expect } from '@playwright/test';

test.describe('Activations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/activations');
    await page.waitForLoadState('networkidle');
  });

  test('loads activations page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows activations page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has activations link in navigation', async ({ page }) => {
    await expect(page.locator('a[href="/activations"]').first()).toBeVisible();
  });

  test('activations page renders without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/activations');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0);
  });
});
