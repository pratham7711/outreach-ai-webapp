import { test, expect } from '@playwright/test';

test.describe('Portal Auth', () => {
  test('login page renders with form fields', async ({ page }) => {
    await page.goto('/portal/login');
    // Should show Creator Portal heading
    await expect(page.getByRole('heading', { name: 'Creator Portal' })).toBeVisible({ timeout: 15000 });
    // Should have email and password inputs (use labels/placeholders from actual page)
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel('Password')).toBeVisible({ timeout: 10000 });
    // Should have sign in button
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/portal/login');
    await expect(page.getByLabel('Email')).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Email').fill('wrong@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();
    // Should show error message
    await expect(page.getByText(/invalid|error|failed/i).first()).toBeVisible({ timeout: 15000 });
  });
});
