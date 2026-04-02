import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Calendar', () => {
  test('calendar page loads with content', async ({ page }) => {
    await navigateAndWait(page, '/calendar');
    await expectHeading(page, 'Calendar');
    // Should show day headers (Sun-Sat) or month navigation
    await expect(page.getByText(/sun|mon|tue|wed|thu|fri|sat/i).first()).toBeVisible({ timeout: 15000 });
  });
});
