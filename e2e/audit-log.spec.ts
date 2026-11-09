import { test, expect } from '@playwright/test';
import { waitForMain } from './helpers';

test.describe('Audit Log', () => {
  test('loads audit log page and shows core controls', async ({ page }) => {
    await page.goto('/audit-log');
    await expect(page).not.toHaveURL(/login/, { timeout: 15000 });
    await waitForMain(page);

    await expect(page.getByRole('heading', { name: 'Audit Log' }).first()).toBeVisible({ timeout: 15000 });
    // Briefly duplicated while the outgoing and incoming trees overlap during
    // the page-enter transition, which trips strict mode.
    await expect(page.getByText('Track changes across your organization').first()).toBeVisible();
    // One toolbar row: the search, then the two quick filters, each named by
    // its own aria-label (the old labelled filter card is gone).
    await expect(page.getByRole('search').getByPlaceholder('Search events')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Action' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Entity' })).toBeVisible();
    // The table keeps its headers whether or not there are events.
    await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'IP address' })).toBeVisible();
  });
});
