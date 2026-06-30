import { test, expect } from '@playwright/test';

test.describe('Public Creator Profile', () => {
  test('public profile does not redirect to login', async ({ page }) => {
    await page.goto('/c/blessingjolie');
    // Wait for page to settle (may redirect if auth required)
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    // Must NOT redirect to login pages
    expect(page.url()).not.toMatch(/\/login/);
    expect(page.url()).not.toMatch(/\/portal\/login/);
  });

  test('public profile shows creator name', async ({ page }) => {
    await page.goto('/c/blessingjolie');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    // The page should display the creator handle or display name from seed data
    await expect(
      page.getByText(/blessingjolie|blessing jolie/i).first()
    ).toBeVisible({ timeout: 30000 });
  });

  test('public profile shows creator stats', async ({ page }) => {
    await page.goto('/c/blessingjolie');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await expect(page.getByText(/blessingjolie|blessing jolie/i).first()).toBeVisible({ timeout: 30000 });
    // Stats section: look for follower/view/rating labels
    await expect(
      page.getByText(/followers|views|rating/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('public profile shows Outreach AI branding', async ({ page }) => {
    await page.goto('/c/blessingjolie');
    await page.waitForLoadState('networkidle', { timeout: 30000 });
    await expect(page.getByText(/blessingjolie|blessing jolie/i).first()).toBeVisible({ timeout: 30000 });
    // Footer or anywhere on page should have Outreach AI branding
    await expect(
      page.getByText(/powered by outreach ai|outreach ai/i).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
