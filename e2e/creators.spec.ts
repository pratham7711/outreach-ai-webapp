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
    // Click on a creator to go to their profile
    const creatorLink = page.getByText('Blessing Jolie').first();
    await creatorLink.click();
    await waitForMain(page);
    await expect(page).toHaveURL(/\/creators\/creator-1/);
    await expect(page.getByText('Blessing Jolie').first()).toBeVisible({ timeout: 15000 });
  });
});
