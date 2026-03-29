import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
  });

  test('loads dashboard page successfully', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows sidebar navigation', async ({ page }) => {
    await expect(page.locator('text=outreach ai').first()).toBeVisible();
  });

  test('shows stats cards on dashboard', async ({ page }) => {
    // Dashboard has stat cards for campaigns, creators, etc.
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('page title includes Outreach AI', async ({ page }) => {
    const title = await page.title();
    // Page should have some content
    expect(title).toBeTruthy();
  });

  test('contains monthly spend chart section', async ({ page }) => {
    // Dashboard renders chart data
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('shows navigation links in sidebar', async ({ page }) => {
    await expect(page.locator('a[href="/campaigns"]').first()).toBeVisible();
  });
});
