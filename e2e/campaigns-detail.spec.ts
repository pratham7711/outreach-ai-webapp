import { test, expect } from '@playwright/test';
import { waitForMain, expectTextOnPage, navigateAndWait, selectFromDropdown } from './helpers';

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
    // Both links arrived. The title no longer carries a count (it disagreed
    // with the submit button's), so the field's own count is what says so.
    const dialog = page.getByRole('dialog', { name: 'Add Posts' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/^2 links found\./)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  });

  test('posts open most-viewed first, unread ones last', async ({ page }) => {
    await navigateAndWait(page, '/campaigns/camp-1?section=posts');
    await expect(page.getByRole('combobox', { name: 'Sort posts by' })).toHaveText(/views/i, { timeout: 15000 });
    await expect(page.getByRole('combobox', { name: 'Sort direction' })).toHaveText(/highest/i);
    const tiles = page.locator('.cc-posttile');
    await expect(tiles.first()).toBeVisible({ timeout: 15000 });
    // A tile with no "N views" is one nobody has read: null, and it comes last
    // whichever way the list is ordered.
    const readViews = async () =>
      (await tiles.allInnerTexts()).map((t) => {
        const m = t.match(/([\d,]+)\s+views/i);
        return m ? Number(m[1].replace(/,/g, '')) : null;
      });
    const unknownLast = (views: (number | null)[]) => {
      const firstUnknown = views.indexOf(null);
      return firstUnknown === -1 || views.slice(firstUnknown).every((v) => v === null);
    };

    const highest = await readViews();
    expect(highest.length).toBeGreaterThan(1);
    expect(highest.some((v) => v !== null && v > 0)).toBe(true);
    const knownHighest = highest.filter((v): v is number => v !== null);
    expect(knownHighest).toEqual([...knownHighest].sort((a, b) => b - a));
    expect(unknownLast(highest)).toBe(true);

    await selectFromDropdown(page, 'Sort direction', 'Lowest');
    await expect(page.getByRole('combobox', { name: 'Sort direction' })).toHaveText(/lowest/i);
    const lowest = await readViews();
    const knownLowest = lowest.filter((v): v is number => v !== null);
    expect(knownLowest).toEqual([...knownLowest].sort((a, b) => a - b));
    expect(unknownLast(lowest)).toBe(true);
  });
});
