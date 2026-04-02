import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Financial Reports', () => {
  test('financial reports page loads', async ({ page }) => {
    await navigateAndWait(page, '/financial-reports');
    await expectHeading(page, 'Financial Reports');
    // Should show period tabs
    await expect(page.getByText(/this month|last month|this quarter/i).first()).toBeVisible({ timeout: 15000 });
  });
});
