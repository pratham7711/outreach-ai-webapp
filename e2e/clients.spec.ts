import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Clients', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/clients');
  });

  test('renders clients heading', async ({ page }) => {
    await expectHeading(page, 'Clients');
  });

  test('lists seed clients', async ({ page }) => {
    await expect(page.getByText('Sony Music').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Universal Records').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Warner Music').first()).toBeVisible({ timeout: 10000 });
  });
});
