import { Page, expect } from '@playwright/test';

/** Wait for the main content area to be visible */
export async function waitForMain(page: Page, timeout = 20000): Promise<void> {
  await page.locator('main').first().waitFor({ state: 'visible', timeout });
}

/**
 * Assert a heading (h1 or h2) with the given text is visible.
 *
 * The default is generous because the first test to touch a route pays for the
 * dev server compiling it, which can outrun a tighter budget even though every
 * later test on the same route is fast.
 */
export async function expectHeading(page: Page, text: string | RegExp, timeout = 30000): Promise<void> {
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

/**
 * Pick an option from one of the design system's dropdowns.
 *
 * There are no native `<select>` elements left in the app, so `selectOption()`
 * has nothing to drive. The trigger is a button carrying `role="combobox"` and
 * its accessible name is the `ariaLabel` the component was given; the options
 * are `role="option"` inside a listbox rendered through a portal, which is why
 * they are addressed on `page` rather than under the trigger.
 */
export async function selectFromDropdown(
  page: Page,
  ariaLabel: string,
  optionLabel: string | RegExp,
): Promise<void> {
  await page.getByRole('combobox', { name: ariaLabel }).click();
  await page.getByRole('option', { name: optionLabel }).first().click();
}

/**
 * Open one section of a campaign from the left rail.
 *
 * The campaign's sections used to be a tab strip inside the page, so the specs
 * reached them with getByRole('tab'). They are rail links now: same
 * destination, different role, and the accessible name carries the count badge
 * ("Posts 7"), which is why this matches on a prefix.
 */
export async function openCampaignSection(page: Page, name: RegExp): Promise<void> {
  const link = page.getByRole('navigation', { name: /campaign navigation/i })
    .getByRole('link', { name })
    .first();
  await link.waitFor({ state: 'visible', timeout: 20000 });
  await link.click();
  await page.waitForLoadState('networkidle');
}

/**
 * Every post on the Posts tab, counted the way the tab itself identifies one.
 *
 * The grid used to carry an `<a href=".../posts/<id>">` in each tile's corner
 * and five specs counted those anchors. The tiles now open a context menu
 * instead -- the corner icons were permanent chrome over the artwork the screen
 * exists to show -- so the anchor is gone and an anchor count reads 0 on a page
 * full of posts. The select box is per post in both the grid and the list, and
 * it is what the tab uses to address one, so it is the honest row handle.
 */
export function postHandles(page: Page) {
  return page.getByRole('checkbox', { name: /^Select post by/ });
}

/**
 * The post detail page for the first post, reached as a user reaches it.
 *
 * Right-click is the only route from the tab to a post's own page since the
 * corner link was removed, so a spec that wants that page has to take it --
 * navigating by a URL the test assembled itself would pass while the route in
 * the product was broken.
 */
export async function firstPostDetailHref(page: Page): Promise<string> {
  const handle = postHandles(page).first();
  await expect(handle).toBeVisible({ timeout: 20000 });
  /* The contextmenu listener sits on the tile, and the event bubbles, so the
     box is a fine target -- and a right-click does not toggle it. */
  await handle.click({ button: 'right' });

  const item = page.getByRole('menu', { name: 'Post actions' })
    .getByRole('menuitem', { name: 'View analytics' });
  await expect(item).toBeVisible({ timeout: 10000 });
  const href = await item.getAttribute('href');
  expect(href, 'the View analytics item should carry an href').toBeTruthy();
  await page.keyboard.press('Escape');
  return href as string;
}
