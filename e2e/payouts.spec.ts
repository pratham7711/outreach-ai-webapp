import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Payouts', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/payouts');
  });

  test('renders payouts heading', async ({ page }) => {
    await expectHeading(page, 'Payouts');
  });

  test('shows seed payout data', async ({ page }) => {
    // 3 seed payouts for Blessing, Alex, Priya
    await expect(page.getByText(/Blessing Jolie|Alex Turner|Priya Patel/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('shows payout status indicators', async ({ page }) => {
    // Seed has SUCCESS and PENDING payouts
    await expect(page.getByText(/success|pending/i).first()).toBeVisible({ timeout: 15000 });
  });
});
