import { test, expect } from '@playwright/test';

/* Home in the creator app: what needs doing, then the creator's campaigns.
   Nothing about money, and no way into the parked screens. */
test.describe('Portal Home', () => {
  test('Home shows the to-do card and the five places', async ({ page }) => {
    await page.goto('/portal/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^(Hi, .+|Home)$/, { timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible({ timeout: 30000 });
    const nav = page.getByRole('navigation', { name: 'Creator app', exact: true });
    for (const name of ['Home', 'Campaigns', 'My accounts', 'My stats', 'Account']) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
  });

  test('Home shows no money and links to no parked screen', async ({ page }) => {
    await page.goto('/portal/dashboard');
    await expect(page.getByRole('heading', { name: 'To do', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/lifetime earnings|total proposals|payout/i)).toHaveCount(0);
    for (const href of ['/portal/earnings', '/portal/proposals', '/portal/offers', '/portal/messages', '/portal/reviews', '/portal/discover']) {
      await expect(page.locator(`a[href^="${href}"]`)).toHaveCount(0);
    }
  });
});
