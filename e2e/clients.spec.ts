import { test, expect } from '@playwright/test';

test.describe('Clients', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
  });

  test('loads clients page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows clients page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has sidebar navigation', async ({ page }) => {
    await expect(page.locator('a[href="/clients"]').first()).toBeVisible();
  });

  test('clients page renders without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/clients');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0);
  });
});
