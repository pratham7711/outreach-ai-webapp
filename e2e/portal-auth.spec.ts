import { test, expect } from '@playwright/test';

test.describe('Portal Auth', () => {
  test('login page renders with form fields', async ({ page }) => {
    await page.goto('/portal/login');
    // Should show Creator Portal heading
    await expect(page.getByRole('heading', { name: 'Creator Portal' })).toBeVisible({ timeout: 15000 });
    // Should have email and password inputs (use labels/placeholders from actual page)
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible({ timeout: 10000 });
    // Should have sign in button
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
  });

  test('/portal on its own leads to the portal, not a 404', async ({ page }) => {
    const res = await page.goto('/portal');
    expect(res?.status()).not.toBe(404);
    // Signed out, the dashboard sends the visitor on to sign in.
    await expect(page).toHaveURL(/\/portal\/(dashboard|login)/, { timeout: 15000 });
    await expect(page.getByText(/page not found|404/i)).toHaveCount(0);
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/portal/login');
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password', { exact: true }).fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Should show error message
    await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible({ timeout: 15000 });
  });
});
