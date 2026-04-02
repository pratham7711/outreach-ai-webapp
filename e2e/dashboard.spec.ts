import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, expectTextOnPage, navigateAndWait } from './helpers';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/dashboard');
  });

  test('renders page heading', async ({ page }) => {
    await expectHeading(page, 'Dashboard');
  });

  test('shows stat cards', async ({ page }) => {
    // Dashboard has stat cards for spend, campaigns, payouts, creators
    await expect(page.getByText('Active Campaigns').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Pending Payouts').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows recent campaigns from seed data', async ({ page }) => {
    // Seed has campaigns like "LEAK IT (BTS)", "FUJI KAZE"
    await expect(page.getByText(/LEAK IT/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('sidebar has navigation links', async ({ page }) => {
    await expect(page.getByRole('link', { name: /campaigns/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /creators/i }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: /payouts/i }).first()).toBeVisible({ timeout: 10000 });
  });
});
