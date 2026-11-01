import { test, expect } from '@playwright/test';
import { navigateAndWait } from './helpers';

/* Creator Finder is switched on per org (OrgPlanConfig.features
   creator_finder) and the seeded demo org does not have it. These pin the off
   state the demo org and every new sign-up see: no sidebar link, the not-found page,
   and 403 from every API route. The on state is covered by unit tests against
   the routes, because turning it on here would mean writing to the shared E2E
   database. */
test.describe('Creator Finder (off for the demo org)', () => {
  test('is not in the sidebar', async ({ page }) => {
    await navigateAndWait(page, '/dashboard');
    await expect(page.locator('a[href="/creator-finder"]')).toHaveCount(0);
  });

  /* The HTTP status is 200, not 404: the dashboard's loading.tsx has already
     streamed the shell by the time the page calls notFound(), so Next can only
     swap the body. What the visitor gets is the not-found page, so assert that. */
  test('its page is the not-found page', async ({ page }) => {
    await page.goto('/creator-finder');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(page.getByTestId('creator-finder')).toHaveCount(0);
  });

  test('its API routes answer 403 and name the feature', async ({ request }) => {
    for (const path of [
      '/api/creator-finder',
      '/api/creator-finder/youtube-search?q=phonk',
      '/api/creator-finder/x/profile',
      '/api/creator-finder/campaigns',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(403);
      expect((await res.json()).error, path).toBe('feature_disabled');
    }
    const add = await request.post('/api/creator-finder', { data: { text: '@someone' } });
    expect(add.status()).toBe(403);
    const ai = await request.post('/api/creator-finder/x/ai', { data: { task: 'read' } });
    expect(ai.status()).toBe(403);
  });
});
