import { test, expect } from '@playwright/test';

/* Discover became Campaigns -> Open: one path into an open campaign, and its
   button joins rather than sending a proposal. */
test.describe('Portal Campaigns', () => {
  test('the old Discover URL opens Campaigns on the Open tab', async ({ page }) => {
    await page.goto('/portal/discover');
    await expect(page).toHaveURL(/\/portal\/campaigns\?tab=open/, { timeout: 30000 });
    await expect(page.getByRole('tab', { name: /^Open/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30000 });
  });

  test('Campaigns has Joined, Invited and Open tabs', async ({ page }) => {
    await page.goto('/portal/campaigns');
    for (const name of [/^Joined/, /^Invited/, /^Open/]) {
      await expect(page.getByRole('tab', { name })).toBeVisible({ timeout: 30000 });
    }
    await expect(page.getByRole('tab', { name: /^Joined/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('an open campaign offers Join, never a proposal', async ({ page }) => {
    await page.goto('/portal/campaigns?tab=open');
    const panel = page.getByRole('tabpanel');
    await expect(panel).toBeVisible({ timeout: 30000 });
    /* Either campaigns to join or the empty state naming the next step. */
    const join = panel.getByRole('button', { name: 'Join', exact: true }).first();
    const empty = panel.getByText('No open campaigns right now');
    await expect(join.or(empty)).toBeVisible({ timeout: 30000 });
    await expect(panel.getByText(/proposal|pitch/i)).toHaveCount(0);
  });
});
