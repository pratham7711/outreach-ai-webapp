import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Discovery', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/discovery');
  });

  test('renders discovery heading', async ({ page }) => {
    await expectHeading(page, 'Discovery');
  });

  test('shows platform filter buttons', async ({ page }) => {
    await expect(page.getByText('All').first()).toBeVisible({ timeout: 15000 });
    // Platform filters from the screenshot: Tiktok, Instagram, Youtube, Twitter
    await expect(page.getByText(/tiktok/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/instagram/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('shows creator cards or disabled state', async ({ page }) => {
    // Discovery may be disabled by feature flag — wait for either state to appear
    await expect(
      page.getByText(/Blessing Jolie|Alex Turner|discovery is disabled|no creators found/i).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
