import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Activations', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/activations');
  });

  test('renders activations heading', async ({ page }) => {
    await expectHeading(page, 'Activations');
  });

  test('shows seed activations', async ({ page }) => {
    // 4 seed activations linking creators to campaigns
    await expect(page.getByText(/Blessing Jolie|Alex Turner|Priya Patel/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('shows status badges', async ({ page }) => {
    // Seed has APPROVED and COMPLETE statuses
    await expect(page.getByText(/approved|complete/i).first()).toBeVisible({ timeout: 15000 });
  });
});
