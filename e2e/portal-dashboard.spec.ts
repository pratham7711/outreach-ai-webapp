import { test, expect } from '@playwright/test';

test.describe('Portal Dashboard', () => {
  test('dashboard loads with welcome message', async ({ page }) => {
    await page.goto('/portal/dashboard');
    // Portal layout has no <main> tag — wait for heading directly
    await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 30000 });
  });

  test('shows stat cards', async ({ page }) => {
    await page.goto('/portal/dashboard');
    await expect(page.getByText(/lifetime earnings/i).first()).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/total proposals/i).first()).toBeVisible({ timeout: 10000 });
  });
});
