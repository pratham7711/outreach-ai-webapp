import { test, expect } from '@playwright/test';
import { waitForMain, expectHeading, navigateAndWait, searchFor } from './helpers';

test.describe('Creators', () => {
  test.beforeEach(async ({ page }) => {
    await navigateAndWait(page, '/creators');
  });

  test('renders creators heading', async ({ page }) => {
    await expectHeading(page, 'Creators');
  });

  test('lists seed creators', async ({ page }) => {
    await expect(page.getByText('Blessing Jolie').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Alex Turner').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Priya Patel').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows platform badges', async ({ page }) => {
    // Seed has Instagram, TikTok, YouTube, Twitter creators
    await expect(page.getByText(/instagram|tiktok|youtube/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('can navigate to creator detail', async ({ page }) => {
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
