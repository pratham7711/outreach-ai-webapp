import { test, expect } from '@playwright/test';
import { openCampaignSection, firstPostDetailHref } from './helpers';

async function navigateToFirstPostDetail(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/campaigns/camp-1');
  await page.waitForLoadState('networkidle');
  await page.getByText('Performance').first().waitFor({ state: 'visible', timeout: 20000 });

  await openCampaignSection(page, /^Posts/i);

  /* camp-1 is seeded with four posts -- counted against the E2E database, not
     assumed -- so an empty list here is a race with the tab's fetch, never a
     data condition. This used to be a flat waitForTimeout(3000) followed by
     `return null`, and every caller answered null with test.fixme(): the race
     then reported as a SKIPPED test inside a green run, which is how a real
     assertion failure in this file went unnoticed. Wait for the thing itself
     and let its absence fail. */
  return firstPostDetailHref(page);
}

/* The tracking card paints after its own fetch, and isVisible() answers at
   once -- its `timeout` option is ignored -- so asking "is Untrack showing?"
   straight after networkidle could read false on a tracked post and then wait
   for a Track button that was never coming. Wait for whichever of the two the
   card settles on, then ask. */
async function trackingState(page: import('@playwright/test').Page) {
  const trackBtn = page.getByRole('button', { name: /^Track$/i }).first();
  const untrackBtn = page.getByRole('button', { name: /^Untrack$/i }).first();
  await expect(trackBtn.or(untrackBtn).first()).toBeVisible({ timeout: 20000 });
  return { trackBtn, untrackBtn, isTracked: await untrackBtn.isVisible() };
}

/* Track and Untrack flip their label the moment they are clicked, before the
   server has said anything, so the label alone proves nothing. This used to
   sleep 2s and hope the write had landed. Wait for the write itself; the
   caller then waits for the button to come back enabled, which happens only
   after the timeseries re-read behind it (components/ds Button hides its
   label and sets aria-busy until then). */
async function toggleTracking(page: import('@playwright/test').Page, button: import('@playwright/test').Locator) {
  await Promise.all([
    page.waitForResponse(
      (r) => /\/posts\/[^/]+\/track$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
      { timeout: 30000 },
    ),
    button.click(),
  ]);
}

test.describe('Post Tracking', () => {
  test('post detail tracking card: Track button toggles to Untrack, status line appears', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingHeading = page.getByText('Tracking').first();
    await expect(trackingHeading).toBeVisible({ timeout: 20000 });

    const { trackBtn, untrackBtn, isTracked } = await trackingState(page);

    if (!isTracked) {
      await toggleTracking(page, trackBtn);

      await expect(untrackBtn).toBeEnabled({ timeout: 15000 });

      const statusLine = page.getByText(/read (hourly|daily|every \d+h), .+(left|finished)/i).first();
      await expect(statusLine).toBeVisible({ timeout: 10000 });
    } else {
      const statusLine = page.getByText(/read (hourly|daily|every \d+h), .+(left|finished)/i).first();
      await expect(statusLine).toBeVisible({ timeout: 10000 });
    }
  });

  test('tracking card: Bot Signals waits for enough snapshots to have run', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const { trackBtn, untrackBtn, isTracked } = await trackingState(page);

    if (!isTracked) {
      await toggleTracking(page, trackBtn);
      await expect(untrackBtn).toBeEnabled({ timeout: 15000 });
    }

    // The heuristics need 3 readings (MIN_SNAPSHOTS in lib/fraud/botSignals.ts);
    // below that the section must not claim "No bot signals detected".
    const [, campaignId, postId] = href.match(/\/campaigns\/([^/]+)\/posts\/([^/?#]+)/) ?? [];
    const res = await page.request.get(`/api/campaigns/${campaignId}/posts/${postId}/timeseries`);
    expect(res.ok()).toBe(true);
    const snapshots = ((await res.json()).snapshots ?? []).length;

    const botSignalsSection = page.getByText('Bot Signals').first();
    if (snapshots >= 3) {
      await expect(botSignalsSection).toBeVisible({ timeout: 15000 });
    } else {
      await expect(page.getByText(/Tracking (on|off)/i).first()).toBeVisible({ timeout: 15000 });
      await expect(botSignalsSection).toHaveCount(0);
      await expect(page.getByText(/no bot signals detected/i)).toHaveCount(0);
    }
  });

  test('Untrack button works: disables tracking after clicking', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingHeading = page.getByText('Tracking').first();
    await expect(trackingHeading).toBeVisible({ timeout: 20000 });

    const { trackBtn, untrackBtn, isTracked } = await trackingState(page);

    if (!isTracked) {
      await toggleTracking(page, trackBtn);
      await expect(untrackBtn).toBeEnabled({ timeout: 15000 });
    }

    await toggleTracking(page, untrackBtn);
    await expect(trackBtn).toBeEnabled({ timeout: 15000 });
  });

  test('timeseries chart section is present in tracking card', async ({ page }) => {
    const href = await navigateToFirstPostDetail(page);

    await page.goto(href);
    await page.waitForLoadState('networkidle');

    const trackingCard = page.getByText('Tracking').first();
    await expect(trackingCard).toBeVisible({ timeout: 20000 });

    const bodyText = await page.textContent('body');
    expect(bodyText?.toLowerCase()).toMatch(/tracking|track/i);
  });
});

/*
 * The Trackers page itself, which LKM opens daily. Until now only the
 * responsive sweep loaded it, and that only waited for an h1, so an API
 * failure rendering "Could not load trackers" still passed.
 */
test.describe('Trackers page', () => {
  test('lists the seeded sounds and switches to Creators', async ({ page }) => {
    await page.goto('/trackers');
    await expect(page.getByRole('heading', { name: 'Trackers' }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Beat Drop Remix').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Could not load trackers')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Creators', exact: true }).first().click();
    await expect(page).toHaveURL(/sub=creator/);
    await expect(page.getByText('Could not load trackers')).toHaveCount(0);
  });
});
