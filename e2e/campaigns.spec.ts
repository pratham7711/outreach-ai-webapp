import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Campaigns', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns');
  });

  test('renders campaigns heading', async ({ page }) => {
    await expectHeading(page, 'Campaigns');
  });

  test('opens on Active, listing the in-progress seeds only', async ({ page }) => {
    // A bare /campaigns -- which is what the sidebar links to -- now opens on
    // Active. LEAK IT and FUJI KAZE are IN_PROGRESS in the seed; CRUEL WORLD is
    // COMPLETE, so it is the one that proves the tab is actually applied.
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('FUJI KAZE').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('CRUEL WORLD')).toBeHidden({ timeout: 10000 });
  });

  test('the All tab still reaches every status', async ({ page }) => {
    // ALL has to travel in the URL: with a bare /campaigns meaning Active, an
    // absent parameter can no longer mean "every status".
    await navigateAndWait(page, '/campaigns?status=ALL');
    await expect(page.getByText('CRUEL WORLD').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows status filter tabs', async ({ page }) => {
    await expect(page.getByText('All').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Active').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Complete').first()).toBeVisible({ timeout: 10000 });
  });

  test('search filters campaigns', async ({ page }) => {
    await searchFor(page, 'LEAK', 'Search Campaigns');
    // Only LEAK IT should remain visible
    await expect(page.getByText('LEAK IT').first()).toBeVisible({ timeout: 10000 });
    // CRUEL WORLD should not be visible
    await expect(page.getByText('CRUEL WORLD')).toBeHidden({ timeout: 5000 });
  });

  test('shows New Campaign button', async ({ page }) => {
    await expect(page.getByText('New Campaign').first()).toBeVisible({ timeout: 15000 });
  });
});

/*
 * The one flow LKM runs most after adding posts: making a campaign. Nothing
 * else in the suite submits the wizard, so a change that left Create Campaign
 * disabled (a hidden step's validation, say) would have shipped green. This
 * drives it the way a person does and removes what it made.
 */
test.describe('Creating a campaign', () => {
  test('the wizard creates a campaign and opens it', async ({ page }) => {
    const title = `E2E create ${Date.now()}`;
    await navigateAndWait(page, '/campaigns');
    await page.getByRole('button', { name: 'New Campaign' }).first().click();
    await page.getByLabel('Campaign Name').fill(title);

    const next = page.getByRole('button', { name: /^Next/ });
    while (await next.isVisible().catch(() => false)) {
      await expect(next).toBeEnabled();
      await next.click();
    }
    const negotiated = page.getByRole('radio', { name: /Negotiated/ });
    if (await negotiated.isVisible().catch(() => false)) await negotiated.click();

    const create = page.getByRole('button', { name: /Create Campaign/ });
    await expect(create).toBeEnabled();
    await create.click();

    await page.waitForURL(/\/campaigns\/[^/?#]+$/, { timeout: 30000 });
    const id = new URL(page.url()).pathname.split('/').pop()!;
    try {
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15000 });
    } finally {
      const res = await page.request.delete(`/api/campaigns/${id}`);
      expect(res.ok()).toBe(true);
    }
  });
});
