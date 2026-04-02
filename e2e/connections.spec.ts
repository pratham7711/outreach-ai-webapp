import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Connections', () => {
  test('connections page loads', async ({ page }) => {
    await navigateAndWait(page, '/connections');
    await expectHeading(page, 'Connections');
    // Should show Social Platforms and Payment Providers sections
    await expect(page.getByText(/social platforms|payment providers/i).first()).toBeVisible({ timeout: 15000 });
  });
});
