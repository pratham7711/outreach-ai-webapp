import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Campaigns', () => {
  test('loads campaigns page', async ({ page }) => {
    await page.goto('/campaigns');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
  });

  test('has main content area', async ({ page }) => {
    await page.goto('/campaigns');
    await waitForMain(page);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sidebar shows campaigns link', async ({ page }) => {
    await page.goto('/campaigns');
    await waitForMain(page);
    await expect(page.locator('a[href="/campaigns"]').first()).toBeVisible();
  });

  test('page contains campaign content', async ({ page }) => {
    await page.goto('/campaigns');
    await waitForMain(page);
    const content = await page.content();
    expect(content.toLowerCase()).toContain('campaign');
  });

  test('can navigate to campaign detail if campaigns exist', async ({ page }) => {
    await page.goto('/campaigns');
    await waitForMain(page);
    const links = page.locator('a[href^="/campaigns/"]');
    const count = await links.count();
    if (count > 0) {
      await links.first().click();
      await expect(page).toHaveURL(/\/campaigns\/.+/, { timeout: 15000 });
    }
  });
});
