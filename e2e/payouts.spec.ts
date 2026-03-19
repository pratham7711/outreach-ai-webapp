import { test, expect } from '@playwright/test';

test.describe('Payouts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/payouts');
    await page.waitForLoadState('networkidle');
  });

  test('loads payouts page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows payouts page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has sidebar with payouts link', async ({ page }) => {
    await expect(page.locator('a[href="/payouts"]').first()).toBeVisible();
  });

  test('payouts page renders without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/payouts');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0);
  });
});
