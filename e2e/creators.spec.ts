import { test, expect } from '@playwright/test';

test.describe('Creators', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/creators');
    await page.waitForLoadState('networkidle');
  });

  test('loads creators page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows creators page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has sidebar navigation visible', async ({ page }) => {
    await expect(page.locator('a[href="/creators"]').first()).toBeVisible();
  });

  test('creators page renders without errors', async ({ page }) => {
    // No JavaScript errors on page load
    const errors: string[] = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto('/creators');
    await page.waitForLoadState('networkidle');
    expect(errors.filter(e => !e.includes('hydration'))).toHaveLength(0);
  });
});
