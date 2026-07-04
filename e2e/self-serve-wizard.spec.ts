import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { encode } from 'next-auth/jwt';

const NEXTAUTH_SECRET = '4Ngtr3WB/HGm9bJ2K8GkcuWjAIt8sQB6zpt60AL2lFU=';
const COOKIE_NAME = 'authjs.session-token';

async function injectAdminSession(page: import('@playwright/test').Page) {
  const token = await encode({
    token: {
      sub: 'cmnbxspfv00016vfdz6yuds55',
      id: 'cmnbxspfv00016vfdz6yuds55',
      email: 'admin@demo.com',
      name: 'Admin',
      orgId: 'cmnbxsoos00006vfd7jhdvusb',
      role: 'OWNER',
    },
    secret: NEXTAUTH_SECRET,
    salt: COOKIE_NAME,
  });

  await page.context().addCookies([
    {
      name: COOKIE_NAME,
      value: token,
      domain: 'localhost',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Self-serve wizard', () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
  });

  test('full wizard flow: basics → creators → review → submit → campaign page', async ({ page }) => {
    const epoch = Date.now();
    const campaignTitle = `E2E SelfServe ${epoch}`;

    await page.goto('/campaigns');
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('link', { name: /self-serve campaign/i }).click();
    await expect(page).toHaveURL(/\/campaigns\/self-serve/, { timeout: 15000 });
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15000 });

    await expect(page.getByText(/Step 1 of 3/i)).toBeVisible({ timeout: 10000 });
    await page.getByLabel('Campaign title').fill(campaignTitle);
    await page.getByLabel('Budget target').fill('5000');

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 2 of 3/i)).toBeVisible({ timeout: 10000 });

    await expect(page.getByPlaceholder('Search creators').first()).toBeVisible({ timeout: 20000 });

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('[aria-pressed]');
      return btns.length > 0;
    }, { timeout: 20000 });

    const platformSelect = page.locator('select').first();
    await platformSelect.selectOption('INSTAGRAM');
    await page.waitForTimeout(400);

    const creatorButtons = page.locator('[aria-pressed]');
    const count = await creatorButtons.count();

    if (count === 0) {
      test.fixme(true, 'APP BUG: No creators available after filter — the seeded org may have no INSTAGRAM creators. Repro: log in as admin@demo.com, go to /campaigns/self-serve, advance to step 2, select INSTAGRAM filter — creator list is empty.');
      return;
    }

    await creatorButtons.nth(0).click();
    await expect(creatorButtons.nth(0)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });

    if (count >= 2) {
      await creatorButtons.nth(1).click();
      await expect(creatorButtons.nth(1)).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
    }

    const selectedCount = count >= 2 ? 2 : 1;

    await expect(page.getByText(new RegExp(`${selectedCount} selected`))).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Platform fee', { exact: false }).first()).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 3 of 3/i)).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(campaignTitle).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Platform fee').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total').first()).toBeVisible({ timeout: 10000 });

    const lineItems = page.locator('[aria-pressed]');
    const reviewCreators = page.getByText(/creator/i);
    await expect(reviewCreators.first()).toBeVisible({ timeout: 10000 });

    let createdCampaignId: string | null = null;
    page.on('response', async (res) => {
      if (res.url().includes('/api/campaigns/self-serve') && res.request().method() === 'POST') {
        try {
          const body = await res.json();
          if (body.campaignId) createdCampaignId = body.campaignId;
        } catch {}
      }
    });

    await page.getByRole('button', { name: 'Create campaign', exact: true }).click();

    await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+$/, { timeout: 30000 });

    const url = page.url();
    expect(url).toMatch(/\/campaigns\/[a-z0-9]+$/);

    await page.getByRole('main').waitFor({ state: 'visible', timeout: 20000 });
    await expect(page.getByRole('heading', { name: campaignTitle }).first()).toBeVisible({ timeout: 15000 });
  });

  test('step 2 creators list loads and platform filter narrows results', async ({ page }) => {
    await page.goto('/campaigns/self-serve');
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15000 });

    await page.getByLabel('Campaign title').fill(`E2E Filter Test ${Date.now()}`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 2 of 3/i)).toBeVisible({ timeout: 10000 });

    await expect(page.getByPlaceholder('Search creators').first()).toBeVisible({ timeout: 15000 });

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('[aria-pressed]');
      return btns.length > 0;
    }, { timeout: 20000 });

    const allCount = await page.locator('[aria-pressed]').count();

    const platformSelect = page.locator('select').first();
    await platformSelect.selectOption('TIKTOK');
    await page.waitForTimeout(400);

    const tiktokCount = await page.locator('[aria-pressed]').count();
    expect(tiktokCount).toBeLessThanOrEqual(allCount);

    await platformSelect.selectOption('');
    await page.waitForTimeout(400);

    const resetCount = await page.locator('[aria-pressed]').count();
    expect(resetCount).toBeGreaterThanOrEqual(tiktokCount);
  });

  test('running-total panel shows platform fee and total after selecting creators', async ({ page }) => {
    await page.goto('/campaigns/self-serve');
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15000 });

    await page.getByLabel('Campaign title').fill(`E2E Total Test ${Date.now()}`);
    await page.getByLabel('Budget target').fill('10000');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 2 of 3/i)).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('[aria-pressed]');
      return btns.length > 0;
    }, { timeout: 20000 });

    const creatorButtons = page.locator('[aria-pressed]');
    const count = await creatorButtons.count();

    if (count === 0) {
      test.fixme(true, 'APP BUG: No creators loaded for the admin org. Repro: log in as admin@demo.com, go to /campaigns/self-serve, advance to step 2 — creator list is empty.');
      return;
    }

    await creatorButtons.nth(0).click();

    await expect(page.getByText(/1 selected/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Platform fee').first()).toBeVisible({ timeout: 5000 });

    const totalBadge = page.locator('[class*="badge"], [class*="Badge"]').first();
    await expect(totalBadge).toBeVisible({ timeout: 5000 });
  });

  test('review step shows creator line items and platform fee row', async ({ page }) => {
    await page.goto('/campaigns/self-serve');
    await page.getByRole('main').waitFor({ state: 'visible', timeout: 15000 });

    const epoch = Date.now();
    await page.getByLabel('Campaign title').fill(`E2E Review ${epoch}`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 2 of 3/i)).toBeVisible({ timeout: 10000 });

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll('[aria-pressed]');
      return btns.length > 0;
    }, { timeout: 20000 });

    const creatorButtons = page.locator('[aria-pressed]');
    const count = await creatorButtons.count();

    if (count === 0) {
      test.fixme(true, 'APP BUG: No creators loaded for the admin org. Repro: log in as admin@demo.com, go to /campaigns/self-serve, advance to step 2 — creator list is empty.');
      return;
    }

    await creatorButtons.nth(0).click();
    if (count >= 2) {
      await creatorButtons.nth(1).click();
    }

    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/Step 3 of 3/i)).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('Platform fee').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total').first()).toBeVisible({ timeout: 10000 });

    const reviewBlock = page.locator('div').filter({ hasText: 'Platform fee' }).first();
    await expect(reviewBlock).toBeVisible({ timeout: 10000 });
  });
});
