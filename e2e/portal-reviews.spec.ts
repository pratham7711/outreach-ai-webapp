import { test, expect } from '@playwright/test';

test.describe('Portal Reviews', () => {
  test('reviews page shows My Reviews heading', async ({ page }) => {
    // Depends on Stream B being merged — adds /portal/reviews page
    await page.goto('/portal/reviews');
    await expect(
      page.getByText(/my reviews/i).first()
    ).toBeVisible({ timeout: 30000 });
  });

  test('reviews page shows My Testimonials section', async ({ page }) => {
    // Depends on Stream B being merged
    await page.goto('/portal/reviews');
    await expect(page.getByText(/my reviews/i).first()).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByText(/my testimonials/i).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('portal dashboard nav contains a Reviews link', async ({ page }) => {
    // Depends on Stream B being merged — adds Reviews to portal sidebar/nav
    await page.goto('/portal/dashboard');
    await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 30000 });
    await expect(
      page.getByRole('link', { name: /reviews/i }).first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('clicking Reviews nav link navigates to /portal/reviews', async ({ page }) => {
    // Depends on Stream B being merged
    await page.goto('/portal/dashboard');
    await expect(page.getByText(/welcome/i).first()).toBeVisible({ timeout: 30000 });
    const reviewsLink = page.getByRole('link', { name: /reviews/i }).first();
    await reviewsLink.waitFor({ state: 'visible', timeout: 15000 });
    await reviewsLink.click();
    await page.waitForURL(/\/portal\/reviews/, { timeout: 15000 });
    await expect(page).toHaveURL(/\/portal\/reviews/);
  });
});
