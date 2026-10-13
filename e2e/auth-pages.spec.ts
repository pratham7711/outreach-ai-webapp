import { test, expect, type Page } from '@playwright/test';
import { collectPageErrors, unexpectedErrors, expectNoHorizontalScroll, PHONE } from './helpers';

/*
 * The account pages a person reaches from an email: forgot / reset password,
 * confirm email, accept a team invitation. No spec visited any of them, so the
 * pages that only matter when something has already gone wrong for a user --
 * a dead link, a mistyped address -- were the ones nothing checked.
 *
 * Signed out, on a phone: these links are opened from a mail app. None of this
 * sends mail. The forgot-password submit uses an address no account has, which
 * the API answers without writing a token or calling a provider
 * (app/api/auth/forgot-password: unknown_email returns before either).
 */
test.use({ storageState: { cookies: [], origins: [] }, viewport: PHONE });

/* Zod's own wording, which a person should never be shown: "Too small:
   expected string to have >=32 characters" (zod 4), "String must contain at
   least 32 character(s)" (zod 3), and the issue-path form. */
const RAW_VALIDATION = /expected string|too small|too big|must contain at least|character\(s\)|>=\s*\d|invalid_type|"path"/i;

async function settle(page: Page, heading: string | RegExp) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 30000 });
}

/** 64 hex characters: the shape of a real reset / confirmation token, owned by nobody. */
function unknownToken() {
  return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

test.describe('Forgot password', () => {
  test('renders, and an unknown address gets the same answer as a known one', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/forgot-password');
    await settle(page, 'Reset your password');
    await expectNoHorizontalScroll(page, '/forgot-password at 390');

    await page.getByPlaceholder('you@company.com').fill(`e2e-nobody-${Date.now()}@example.com`);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/forgot-password') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /send reset link/i }).click(),
    ]);
    expect(res.status()).toBe(200);
    /* Which heading depends on whether this deployment has a mail provider,
       not on the address -- so it cannot be used to probe for accounts. */
    await expect(page.getByRole('heading', { level: 1, name: /check your email|can't email you yet/i })).toBeVisible({
      timeout: 15000,
    });
    await expectNoHorizontalScroll(page, '/forgot-password sent state at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
  });
});

test.describe('Reset password', () => {
  test('without a token it says the link is missing and offers a new one', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/reset-password');
    await settle(page, 'Reset link missing');
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
    await expectNoHorizontalScroll(page, '/reset-password at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  /* Written to survive the copy changing. Today the API answers "This reset
     link is not valid"; a rewording such as "This reset link is invalid or has
     expired" passes too, and so would a page that rejects the token before
     showing the form at all. What fails is no error, or a validator's raw
     message.

     The truncated token is the case a mail client produces by cutting a link
     short. Until 2026-10-13 it failed the API's zod schema and the page showed
     "Too small: expected string to have >=32 characters" verbatim;
     app/api/auth/reset-password now answers it in the same words as an
     unknown token. */
  for (const [label, token] of [
    ['an unknown token', unknownToken()],
    ['a truncated token', 'abc123'],
  ] as const) {
    test(`with ${label} it shows a plain-language error`, async ({ page }) => {
      const errors = collectPageErrors(page);
      await page.goto(`/reset-password?token=${token}`);

      const form = page.getByPlaceholder('••••••••').first();
      /* filter: Next mounts an empty role="alert" route announcer on every
         page, and an unfiltered getByRole('alert') finds that first. */
      const errorState = page
        .getByRole('alert')
        .filter({ hasText: /\S/ })
        .or(page.getByRole('heading', { level: 1, name: /invalid|expired|not valid|no longer/i }));
      await expect(form.or(errorState).first()).toBeVisible({ timeout: 30000 });

      if (await form.isVisible()) {
        await page.getByPlaceholder('••••••••').nth(0).fill('E2e-new-password-1');
        await page.getByPlaceholder('••••••••').nth(1).fill('E2e-new-password-1');
        await page.getByRole('button', { name: /update password/i }).click();
      }

      await expect(errorState.first()).toBeVisible({ timeout: 15000 });
      const text = (await errorState.first().innerText()).trim();
      expect(text, 'the error names the link').toMatch(/reset link|link|invalid|expired|not valid/i);
      expect(text, 'no raw validator message').not.toMatch(RAW_VALIDATION);
      await expect(page.getByRole('heading', { name: 'Password updated' })).toHaveCount(0);
      await expectNoHorizontalScroll(page, `/reset-password with ${label} at 390`);
      expect(unexpectedErrors(errors, { allowHttp4xx: true })).toEqual([]);
    });
  }
});

test.describe('Confirm email', () => {
  test('without a token it says the confirmation link is missing', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/verify-email');
    await settle(page, 'Confirmation link missing');
    await expectNoHorizontalScroll(page, '/verify-email at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test('with an unknown token it says the link is not valid', async ({ page }) => {
    const errors = collectPageErrors(page);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/verify-email') && r.request().method() === 'POST', {
        timeout: 30000,
      }),
      page.goto(`/verify-email?token=${unknownToken()}`),
    ]);
    expect(res.status()).toBe(400);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(/not valid|invalid|expired/i, { timeout: 15000 });
    expect(await heading.innerText()).not.toMatch(RAW_VALIDATION);
    await expectNoHorizontalScroll(page, '/verify-email with an unknown token at 390');
    expect(unexpectedErrors(errors, { allowHttp4xx: true })).toEqual([]);
  });
});

test.describe('Accept a team invitation', () => {
  test('without a token it says the link is incomplete', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/accept-invite');
    await settle(page, 'This invite link is incomplete');
    await expectNoHorizontalScroll(page, '/accept-invite at 390');
    expect(unexpectedErrors(errors)).toEqual([]);
  });

  test("with an unknown token it says the invitation can't be used", async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(`/accept-invite?token=${unknownToken()}`);
    await settle(page, /this invitation can.t be used/i);
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expectNoHorizontalScroll(page, '/accept-invite with an unknown token at 390');
    expect(unexpectedErrors(errors, { allowHttp4xx: true })).toEqual([]);
  });
});
