import { test, expect } from '@playwright/test';

test.describe('Portal Discover', () => {
  test('discover page loads with content', async ({ page }) => {
    await page.goto('/portal/discover');
    // Portal layout has no <main> tag — wait for heading directly
    await expect(page.getByText('Discover Campaigns').first()).toBeVisible({ timeout: 30000 });
  });

  test('shows search and filter controls', async ({ page }) => {
    await page.goto('/portal/discover');
    await expect(page.getByText('Discover Campaigns').first()).toBeVisible({ timeout: 30000 });
    // Should have search input
    await expect(page.getByPlaceholder(/search campaigns/i).first()).toBeVisible({ timeout: 10000 });
  });
});
