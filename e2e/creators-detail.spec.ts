import { test, expect } from '@playwright/test';
import { waitForMain, expectTextOnPage, navigateAndWait } from './helpers';

test.describe('Creator Detail', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/creators/creator-1');
  });

  test('shows creator name and handle', async ({ page }) => {
    await expectTextOnPage(page, 'Blessing Jolie');
    await expectTextOnPage(page, 'blessingjolie');
  });

  test('shows profile tabs', async ({ page }) => {
    await expect(page.getByText(/profile/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/posts/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/campaigns/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows follower stats', async ({ page }) => {
    // Blessing Jolie has 2.4M followers
    await expect(page.getByText(/followers/i).first()).toBeVisible({ timeout: 15000 });
  });
});
