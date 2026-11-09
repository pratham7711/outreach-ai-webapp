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
    // Either the empty state or at least one list card.
    await expect(
      main.getByText(/no lists yet|no active lists/i).or(main.locator('.cc-list-card')).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
