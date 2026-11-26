import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Creators', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/creators');
  });

  test('renders creators heading', async ({ page }) => {
    await expectHeading(page, 'Creator Roster');
  });

  test('lists seed creators under Manual entries', async ({ page }) => {
    await navigateAndWait(page, '/creators?source=manual');
    await expect(page.getByText('Blessing Jolie').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Alex Turner').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Priya Patel').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows platform badges', async ({ page }) => {
    await navigateAndWait(page, '/creators?source=manual');
    // Seed has Instagram, TikTok, YouTube, Twitter creators
    await expect(page.getByText(/instagram|tiktok|youtube/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('Manual entries replaces the Twitter tab and lists only rows nobody signed up for', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Filter creators by platform' });
    await expect(tabs.getByRole('tab', { name: /^Twitter/ })).toHaveCount(0);
    await tabs.getByRole('tab', { name: /^Manual entries/ }).click();
    await expect(page).toHaveURL(/[?&]source=manual\b/);
    await expect(tabs.getByRole('tab', { name: /^Manual entries/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('main').getByText('Signed up', { exact: true })).toHaveCount(0);
  });

  test('All leaves manual entries out: every row it lists signed up', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Filter creators by platform' });
    await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
    const main = page.locator('main');
    const showManual = main.getByTestId('roster-show-manual');
    const badges = main.getByText('Signed up', { exact: true });
    await expect(showManual.or(badges.first())).toBeVisible({ timeout: 15000 });
    if (await showManual.count()) {
      await showManual.click();
      await expect(page).toHaveURL(/[?&]source=manual\b/);
      return;
    }
    const rows = main.getByRole('checkbox', { name: /^Select (?!all\b)/i });
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    await expect(badges).toHaveCount(rowCount);
  });

  test('can navigate to creator detail', async ({ page }) => {
    await navigateAndWait(page, '/creators?source=manual');
    /* Assert against the href the link actually carries, not the seed id
       'creator-1'. The hardcoded id only held while exactly one row was named
       Blessing Jolie; it says nothing about whether navigation worked, and it
       failed the moment a second row with that name existed even though the
       click had gone exactly where the link pointed. Reading the href first
       tests the real behaviour -- the row you click is the row you land on --
       and does not care which of them sorts first. */
    const creatorLink = page.getByRole('link', { name: /Blessing Jolie/ }).first();
    const href = await creatorLink.getAttribute('href');
    expect(href).toMatch(/^\/creators\/[^/]+$/);
    await creatorLink.click();
    await waitForMain(page);
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByText('Blessing Jolie').first()).toBeVisible({ timeout: 15000 });
  });
});
