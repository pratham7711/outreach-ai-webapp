import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
  });

  test('renders campaigns heading', async ({ page }) => {
    await expectHeading(page, 'Campaigns');
  });

  test('opens on Active, listing the in-progress seeds only', async ({ page }) => {
    // A bare /campaigns -- which is what the sidebar links to -- now opens on
    // Active. LEAK IT and FUJI KAZE are IN_PROGRESS in the seed; CRUEL WORLD is
    // COMPLETE, so it is the one that proves the tab is actually applied.
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('FUJI KAZE').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('CRUEL WORLD')).toBeHidden({ timeout: 10000 });
  });

  test('the All tab still reaches every status', async ({ page }) => {
    // ALL has to travel in the URL: with a bare /campaigns meaning Active, an
    // absent parameter can no longer mean "every status".
    await navigateAndWait(page, '/campaigns?status=ALL');
    await expect(page.getByText('CRUEL WORLD').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 10000 });
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
