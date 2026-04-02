import { test, expect } from '@playwright/test';
import { waitForMain, expectTextOnPage, navigateAndWait } from './helpers';

test.describe('Campaign Detail', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1');
  });

  test('loads campaign with title', async ({ page }) => {
    await expectTextOnPage(page, 'LEAK IT');
  });

  test('shows campaign status', async ({ page }) => {
    // camp-1 is IN_PROGRESS
    await expect(page.getByText(/active|in.progress/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('shows detail tabs', async ({ page }) => {
    await expect(page.getByText('Overview').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Posts').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows budget info', async ({ page }) => {
    // camp-1 has $25,000 budget
    await expect(page.getByText(/25,000|25K/i).first()).toBeVisible({ timeout: 15000 });
  });
});
