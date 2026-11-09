import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, collectPageErrors, unexpectedErrors } from './helpers';

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

  /* Two settings pages nothing opened before. Each is a fetch behind a header,
     so the header alone proves only the shell; the assertion is on what the
     fetch fills in. */
  test('notifications page lists the events you can mute', async ({ page }) => {
    const errors = collectPageErrors(page);
    await navigateAndWait(page, '/settings/notifications');
    await expectHeading(page, 'Notifications');
    await expect(page.getByText('Campaign Created').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Post Uploaded').first()).toBeVisible();
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('integrations page offers Slack', async ({ page }) => {
    const errors = collectPageErrors(page);
    await navigateAndWait(page, '/settings/integrations');
    await expectHeading(page, 'Integrations');
    await expect(page.locator('.cc-provider-name').filter({ hasText: 'Slack' })).toBeVisible({ timeout: 20000 });
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});
