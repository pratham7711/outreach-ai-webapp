import { test, expect } from '@playwright/test';
import { expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Recipients', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/recipients');
  });

  test('renders recipients heading', async ({ page }) => {
    await expectHeading(page, 'Recipients');
  });

  test('shows recipient summary stats', async ({ page }) => {
    await expect(page.getByText(/total paid/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('derives recipients from seed payouts', async ({ page }) => {
    await expect(page.getByText(/Blessing Jolie|Alex Turner|Priya Patel/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('filters recipients by search', async ({ page }) => {
    // Without the explicit placeholder this types into the TopBar's
    // "Search pages..." box, which comes first in the DOM.
    await searchFor(page, 'zzzznotarealrecipient', 'Search Recipients');
    await expect(page.getByText(/no matches/i).first()).toBeVisible({ timeout: 15000 });
  });
});
