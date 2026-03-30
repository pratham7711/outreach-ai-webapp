import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Audit Log', () => {
  test('loads audit log page and shows core controls', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
    await waitForMain(page);

    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Track changes across your organization')).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Action' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Entity' })).toBeVisible();
    await expect(page.locator('label').filter({ hasText: 'Search' })).toBeVisible();
    await expect(page.getByRole('combobox').first()).toBeVisible();
    await expect(page.getByRole('combobox').nth(1)).toBeVisible();
    await expect(page.getByPlaceholder('Search label, email, IP...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
  });
});
