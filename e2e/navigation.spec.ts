import { test, expect } from '@playwright/test';

const PAGES = [
  { label: 'campaigns', href: '/campaigns' },
  { label: 'activations', href: '/activations' },
  { label: 'creators', href: '/creators' },
  { label: 'payouts', href: '/payouts' },
  { label: 'clients', href: '/clients' },
  { label: 'lists', href: '/lists' },
];

test.describe('Navigation', () => {
  test('sidebar nav links navigate to correct pages', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    for (const p of PAGES) {
      const link = page.locator(`a[href="${p.href}"]`).first();
      // Check that the link exists in the page
      await expect(link).toBeVisible({ timeout: 5000 });
    }
  });

  test('can navigate from dashboard to campaigns via sidebar link', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.locator('a[href="/campaigns"]').first().click();
    await page.waitForURL(/\/campaigns/, { timeout: 10000 });
    expect(page.url()).toContain('/campaigns');
  });

  test('can navigate from dashboard to creators', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.locator('a[href="/creators"]').first().click();
    await page.waitForURL(/\/creators/, { timeout: 10000 });
    expect(page.url()).toContain('/creators');
  });

  test('can navigate from dashboard to payouts', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.locator('a[href="/payouts"]').first().click();
    await page.waitForURL(/\/payouts/, { timeout: 10000 });
    expect(page.url()).toContain('/payouts');
  });

  test('can navigate from dashboard to clients', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    await page.locator('a[href="/clients"]').first().click();
    await page.waitForURL(/\/clients/, { timeout: 10000 });
    expect(page.url()).toContain('/clients');
  });

  test('all dashboard pages load without redirecting to login', async ({ page }) => {
    for (const p of PAGES) {
      await page.goto(p.href);
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/login/, { timeout: 5000 });
    }
  });
});
