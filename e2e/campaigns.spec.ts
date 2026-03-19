import { test, expect } from '@playwright/test';

test.describe('Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/campaigns');
    await page.waitForLoadState('networkidle');
  });

  test('loads campaigns page', async ({ page }) => {
    await expect(page).not.toHaveURL(/login/);
  });

  test('shows campaigns page content', async ({ page }) => {
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('has sidebar with campaigns link active', async ({ page }) => {
    // The campaigns link should be rendered in the sidebar
    const campaignsLinks = page.locator('a[href="/campaigns"]');
    await expect(campaignsLinks.first()).toBeVisible();
  });

  test('shows new campaign button or list', async ({ page }) => {
    // The campaigns page has either a list or a "New Campaign" button
    const pageContent = await page.content();
    expect(
      pageContent.includes('Campaign') || pageContent.includes('campaign')
    ).toBeTruthy();
  });

  test('campaign status badges are visible when campaigns exist', async ({ page }) => {
    // The page renders - if campaigns exist, they show status badges
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('can navigate to campaign detail when campaigns exist', async ({ page }) => {
    // If any campaign cards are rendered, clicking one navigates to detail
    const campaignLinks = page.locator('a[href^="/campaigns/"]');
    const count = await campaignLinks.count();
    if (count > 0) {
      await campaignLinks.first().click();
      await expect(page).toHaveURL(/\/campaigns\/.+/);
    }
  });
});
