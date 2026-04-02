import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
  });

  test('renders campaigns heading', async ({ page }) => {
    await expectHeading(page, 'Campaigns');
  });

  test('lists seed campaigns', async ({ page }) => {
    // 5 seed campaigns
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('FUJI KAZE').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('CRUEL WORLD').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows status filter tabs', async ({ page }) => {
    await expect(page.getByText('All').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Complete').first()).toBeVisible({ timeout: 10000 });
  });

  test('search filters campaigns', async ({ page }) => {
    await searchFor(page, 'LEAK', 'Search Campaigns');
    // Only LEAK IT should remain visible
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 10000 });
    // CRUEL WORLD should not be visible
    await expect(page.getByText('CRUEL WORLD')).toBeHidden({ timeout: 5000 });
  });

  test('shows New Campaign button', async ({ page }) => {
    await expect(page.getByText('New Campaign').first()).toBeVisible({ timeout: 15000 });
  });
});
