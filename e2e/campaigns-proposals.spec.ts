import { test, expect } from '@playwright/test';
import { navigateAndWait } from './helpers';

test.describe('Campaign Proposals and Reviews', () => {
  test('campaign detail page loads for camp-1', async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1');
    // Campaign name from seed: "LEAK IT - BTS"
    await expect(page.getByText(/LEAK IT/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('Creators tab shows proposals section', async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1');
    // Click the Creators tab button in the campaign detail tabs bar (not the sidebar link)
    const tabBar = page.locator('div').filter({ has: page.locator('button:has-text("Overview")') }).first();
    const creatorsTab = tabBar.locator('button', { hasText: /^Creators/ });
    await creatorsTab.waitFor({ state: 'visible', timeout: 30000 });
    await creatorsTab.click();
    // ProposalsSection should render under Creators tab
    await expect(
      page.getByText(/creator proposals/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('Reviews tab exists in the campaign tab list', async ({ page }) => {
    // Depends on Stream A being merged
    await navigateAndWait(page, '/campaigns/camp-1');
    await expect(
      page.getByRole('tab', { name: /reviews/i }).or(
        page.getByText(/^reviews$/i)
      ).first()
    ).toBeVisible({ timeout: 30000 });
  });

  test('Reviews tab shows Creator Reviews or empty state', async ({ page }) => {
    // Depends on Stream A being merged
    await navigateAndWait(page, '/campaigns/camp-1');
    const reviewsTab = page.getByRole('tab', { name: /reviews/i }).or(
      page.getByText(/^reviews$/i)
    ).first();
    await reviewsTab.waitFor({ state: 'visible', timeout: 30000 });
    await reviewsTab.click();
    // ReviewsSection renders "Creator Reviews" heading or "No reviews yet" empty state
    await expect(
      page.getByText(/creator reviews|no reviews yet/i).first()
    ).toBeVisible({ timeout: 15000 });
  });
});
