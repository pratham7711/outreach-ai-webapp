import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the hero section', async ({ page }) => {
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should have a navigation bar', async ({ page }) => {
    await expect(page.locator('nav')).toBeVisible();
  });

  test('should have a "Get Started" CTA button', async ({ page }) => {
    const cta = page.locator('button:has-text("Get Started"), a:has-text("Get Started")');
    await expect(cta).toBeVisible();
  });
});

test.describe('Authentication', () => {
  test('should navigate to login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('should show validation errors on empty submit', async ({ page }) => {
    await page.goto('/login');
    await page.click('button[type="submit"]');
    await expect(page.locator('[role="alert"]')).toContainText('required');
  });
});
