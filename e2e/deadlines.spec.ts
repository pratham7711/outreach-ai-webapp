import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Deadlines', () => {
  test('deadlines page loads', async ({ page }) => {
    await navigateAndWait(page, '/deadlines');
    await expectHeading(page, 'Deadlines');
    // Should show stat cards or empty state
    await expect(page.getByText(/overdue|due this week|completed|no date/i).first()).toBeVisible({ timeout: 15000 });
  });
});
