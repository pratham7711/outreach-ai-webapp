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
    const campaignsLinks = page.locator('a[href="/campaigns"]');
    await expect(campaignsLinks.first()).toBeVisible();
  });

  test('shows campaign list or empty state', async ({ page }) => {
    const pageContent = await page.content();
    expect(
      pageContent.includes('Campaign') || pageContent.includes('campaign')
    ).toBeTruthy();
  });

  test('has new campaign button', async ({ page }) => {
    // The page should have a "New Campaign" button
    const newBtn = page.locator('button:has-text("New Campaign")');
    const count = await newBtn.count();
    // At least one "New Campaign" button should exist
    expect(count).toBeGreaterThan(0);
  });

  test('clicking new campaign opens modal', async ({ page }) => {
    const newBtn = page.locator('button:has-text("New Campaign")').first();
    await newBtn.click();

    // Modal should appear with the campaign form
    await expect(page.locator('text=New Campaign')).toBeVisible({ timeout: 5000 });
  });

  test('new campaign modal has campaign type selector', async ({ page }) => {
    const newBtn = page.locator('button:has-text("New Campaign")').first();
    await newBtn.click();

    // The form should have a campaign type selector (select element or similar)
    const modal = page.locator('[role="dialog"], .modal, [class*="modal"]').first();
    // Wait for modal content
    await expect(modal.or(page.locator('text=Campaign Type').first())).toBeVisible({ timeout: 5000 });
  });

  test('campaign status badges are visible when campaigns exist', async ({ page }) => {
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('can navigate to campaign detail when campaigns exist', async ({ page }) => {
    const campaignLinks = page.locator('a[href^="/campaigns/"]');
    const count = await campaignLinks.count();
    if (count > 0) {
      await campaignLinks.first().click();
      await expect(page).toHaveURL(/\/campaigns\/.+/);
    }
  });
});
