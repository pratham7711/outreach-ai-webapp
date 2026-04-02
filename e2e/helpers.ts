import { Page, expect } from '@playwright/test';

/** Wait for the main content area to be visible */
export async function waitForMain(page: Page, timeout = 20000): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'visible', timeout });
}

/** Assert a heading (h1 or h2) with the given text is visible */
export async function expectHeading(page: Page, text: string | RegExp, timeout = 15000): Promise<void> {
  await expect(page.getByRole('heading', { name: text }).first()).toBeVisible({ timeout });
}

/** Assert text appears somewhere on the page */
export async function expectTextOnPage(page: Page, text: string | RegExp, timeout = 15000): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
}

/** Assert a minimum number of matching elements on the page */
export async function expectMinItems(page: Page, selector: string, minCount: number, timeout = 15000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout });
  const count = await page.locator(selector).count();
  expect(count).toBeGreaterThanOrEqual(minCount);
}

/** Type into a search input and wait for debounce */
export async function searchFor(page: Page, text: string, placeholder: string | RegExp = /search/i): Promise<void> {
  const input = page.getByPlaceholder(placeholder).first();
  await input.fill(text);
  await page.waitForTimeout(600);
}

/** Navigate to a page and wait for main content */
export async function navigateAndWait(page: Page, path: string, timeout = 30000): Promise<void> {
  await page.goto(path);
  await waitForMain(page, timeout);
}
