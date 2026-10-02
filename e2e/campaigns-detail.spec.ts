import { test, expect } from '@playwright/test';
import { waitForMain, expectTextOnPage, navigateAndWait } from './helpers';

test.describe('Campaign Detail', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1');
  });

  test('loads campaign with title', async ({ page }) => {
    await expectTextOnPage(page, 'LEAK IT');
  });

  test('shows campaign status', async ({ page }) => {
    // camp-1 is IN_PROGRESS
    await expect(page.getByText(/active|in.progress/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('shows detail tabs', async ({ page }) => {
    await expect(page.getByText('Overview').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Posts').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows budget info', async ({ page }) => {
    // The page opens on Posts; the budget tile lives on Overview, so ask for
    // that section rather than the default. (?tab= is the legacy spelling and
    // is still honoured -- this asserts that too.)
    await navigateAndWait(page, '/campaigns/camp-1?tab=overview');
    // camp-1 has a $25,000 budget, rendered compactly as $25K.
    await expect(page.getByText(/25,000|25K/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('links pasted on the Posts tab open Add Posts with them in it', async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1?section=posts');
    await expect(page.getByRole('button', { name: 'Add Posts' })).toBeVisible({ timeout: 15000 });
    const paste = (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'https://www.tiktok.com/@demo/video/7430000000000000001\nhttps://www.tiktok.com/@demo/video/7430000000000000002');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });

    // A paste into a field is that field's.
    await paste('input[placeholder="Search creator..."]');
    await expect(page.locator('#add-post-urls')).toHaveCount(0);

    await paste('main');
    // The title counts the dialog's rows, so it says both links arrived.
    await expect(page.getByRole('dialog', { name: 'Add 2 Posts' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  });
});
