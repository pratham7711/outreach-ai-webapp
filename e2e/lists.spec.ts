import { test, expect } from '@playwright/test';

test.describe('Creator Lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/lists');
    await page.waitForLoadState('networkidle');
  });

  test('loads lists page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows lists page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has lists link in navigation', async ({ page }) => {
    await expect(page.locator('a[href="/lists"]').first()).toBeVisible();
  });

  test('lists page renders without critical errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/lists');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0);
  });
});
