import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads dashboard without redirect to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('shows sidebar with brand name', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('outreach ai').first()).toBeVisible({ timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
  });

  test('page has a title', async ({ page }) => {
    await page.goto('/dashboard');
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('sidebar has campaigns link', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('a[href="/campaigns"]').first()).toBeVisible({ timeout: 15000 });
  });
});
