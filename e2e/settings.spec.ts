import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Settings', () => {
  test('settings hub page loads with navigation cards', async ({ page }) => {
    await navigateAndWait(page, '/settings');
    await expectHeading(page, 'Settings');
    // Billing left with the money side; Activity Log moved here for admins.
    const main = page.locator('main');
    await expect(main.getByText('Profile').first()).toBeVisible({ timeout: 15000 });
    await expect(main.getByText('Team').first()).toBeVisible({ timeout: 10000 });
    await expect(main.getByText('Activity Log').first()).toBeVisible({ timeout: 10000 });
    await expect(main.getByText('Billing')).toHaveCount(0);
  });

  test('profile page loads', async ({ page }) => {
    await navigateAndWait(page, '/settings/profile');
    await expectHeading(page, /organization profile/i);
  });

  test('team page loads', async ({ page }) => {
    await navigateAndWait(page, '/settings/team');
    await waitForMain(page);
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 15000 });
  });

  test('api keys page loads', async ({ page }) => {
    await navigateAndWait(page, '/settings/api-keys');
    await waitForMain(page);
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 15000 });
  });
});
