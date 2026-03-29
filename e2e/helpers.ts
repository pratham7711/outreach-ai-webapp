import { Page } from '@playwright/test';

export async function waitForMain(page: Page, timeout = 20000): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'visible', timeout });
}
