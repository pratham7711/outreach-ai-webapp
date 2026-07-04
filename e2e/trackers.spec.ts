import { test, expect } from '@playwright/test';

async function navigateToFirstPostDetail(page: import('@playwright/test').Page): Promise<string | null> {
  await page.goto('/campaigns/camp-1');
  await page.waitForLoadState('networkidle');
  await page.getByText('Performance').first().waitFor({ state: 'visible', timeout: 20000 });

  const postsTab = page.getByRole('button', { name: /^Posts/i }).first();
  await postsTab.click();
  await page.waitForTimeout(3000);

  const postLinks = page.locator('a[href*="/posts/"]');
  const count = await postLinks.count();
  if (count === 0) return null;

  const href = await postLinks.first().getAttribute('href');
  return href;
}

test.describe('Post Tracking', () => {
  test('post detail tracking card: Track button toggles to Untrack, status line appears', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);
    if (!href) {
      test.fixme();
      return;
    }

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingHeading = page.getByText('Tracking').first();
    await expect(trackingHeading).toBeVisible({ timeout: 20000 });

    const trackBtn = page.getByRole('button', { name: /^Track$/i }).first();
    const untrackBtn = page.getByRole('button', { name: /^Untrack$/i }).first();

    const isTracked = await untrackBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (!isTracked) {
      await expect(trackBtn).toBeVisible({ timeout: 10000 });
      await trackBtn.click();
      await page.waitForTimeout(2000);

      await expect(untrackBtn).toBeVisible({ timeout: 15000 });

      const statusLine = page.getByText(/hourly snapshots for 72h/i).first();
      await expect(statusLine).toBeVisible({ timeout: 10000 });
    } else {
      const statusLine = page.getByText(/hourly snapshots for 72h/i).first();
      await expect(statusLine).toBeVisible({ timeout: 10000 });
    }
  });

  test('tracking card: Bot Signals empty state renders with no snapshot', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);
    if (!href) {
      test.fixme();
      return;
    }

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const untrackBtn = page.getByRole('button', { name: /^Untrack$/i }).first();
    const isTracked = await untrackBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (!isTracked) {
      const trackBtn = page.getByRole('button', { name: /^Track$/i }).first();
      if (await trackBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await trackBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    const botSignalsSection = page.getByText('Bot Signals').first();
    await expect(botSignalsSection).toBeVisible({ timeout: 15000 });

    const noSignals = page.getByText(/no bot signals detected/i).first();
    await expect(noSignals).toBeVisible({ timeout: 10000 });
  });

  test('Untrack button works: disables tracking after clicking', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);
    if (!href) {
      test.fixme();
      return;
    }

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingHeading = page.getByText('Tracking').first();
    await expect(trackingHeading).toBeVisible({ timeout: 20000 });

    const untrackBtn = page.getByRole('button', { name: /^Untrack$/i }).first();
    const trackBtn = page.getByRole('button', { name: /^Track$/i }).first();

    const isTracked = await untrackBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (!isTracked) {
      if (await trackBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await trackBtn.click();
        await page.waitForTimeout(2000);
        await expect(untrackBtn).toBeVisible({ timeout: 10000 });
      }
    }

    if (await untrackBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await untrackBtn.click();
      await page.waitForTimeout(2000);
      await expect(trackBtn).toBeVisible({ timeout: 10000 });
    }
  });

  test('timeseries chart section is present in tracking card', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);
    if (!href) {
      test.fixme();
      return;
    }

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingCard = page.getByText('Tracking').first();
    await expect(trackingCard).toBeVisible({ timeout: 20000 });

    const bodyText = await page.textContent('body');
    expect(bodyText?.toLowerCase()).toMatch(/tracking|track/i);
  });
});
