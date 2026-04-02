import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait } from './helpers';

test.describe('Lists', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/lists');
  });

  test('renders lists heading', async ({ page }) => {
    await expectHeading(page, 'Lists');
  });

  test('shows empty state or list data', async ({ page }) => {
    // No seed data for lists — expect either empty state or some content
    const main = page.locator('main');
    await expect(main).toBeVisible({ timeout: 15000 });
    // Page should have either list items or an empty state message
    const hasContent = await page.getByText(/no lists|create|add/i).first().isVisible().catch(() => false);
    const hasLists = await page.locator('table, [class*="card"]').first().isVisible().catch(() => false);
    expect(hasContent || hasLists).toBeTruthy();
  });
});
