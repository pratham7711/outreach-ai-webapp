import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ACTIONS, isActionId } from '../lib/ui/actions';

/**
 * The runtime half of the action registry.
 *
 * `lib/ui/actions.ts` makes a *typo* impossible -- `action("new-campiagn")` is a
 * compile error. It cannot make an *omission* impossible: a new button that
 * simply never calls `action()` type-checks perfectly, and the only symptom is
 * that `:root.creatorcore [data-action="..."]` matches nothing later. A missing
 * attribute is not a property of any one file, so no lint rule can see it. It is
 * a property of the rendered page, which is why this is a Playwright spec.
 *
 * Two things are asserted, and they are deliberately the two that are
 * unambiguous:
 *
 *   1. Every `data-action` in the DOM is a registry id. This catches a
 *      hand-written attribute and a registry entry deleted out from under a
 *      call site -- neither of which the type system sees, because the string
 *      never passes through `action()`.
 *   2. Every control in the primary slot of an action region carries one. The
 *      primary action is the control a white-label tenant is most likely to be
 *      told it may not have, so it is the one that must always be addressable.
 *
 * Every OTHER control inside an action region is inventoried rather than
 * asserted. An action region legitimately holds things that are not actions --
 * a count badge, a range picker, a view toggle, a filter chip -- and a blanket
 * "every button must be tagged" would fail on those and get the spec disabled
 * within a week. The inventory is written to `.action-inventory.json` so the
 * untagged set is visible and can be ratcheted once it has been read.
 */

const THEMES = ['light'] as const;

/* The routes that have a page header with actions. Kept explicit rather than
   crawled: a crawl that silently visits fewer pages passes as clean. */
const PAGES = [
  '/dashboard',
  '/campaigns',
  '/creators',
  '/clients',
  '/lists',
  '/discovery',
  '/activations',
  '/payouts',
  '/reports',
  '/analytics',
  '/calendar',
  '/settings',
  '/settings/team',
  '/settings/api',
  '/campaigns/camp-1?tab=overview',
  '/campaigns/camp-1?tab=posts',
];

type Control = {
  path: string;
  tag: string;
  text: string;
  actionId: string | null;
  slot: string | null;
  region: string;
};

test('every action control is addressable by a theme', async ({ page }) => {
  const controls: Control[] = [];
  const coverage: { path: string; regions: number; controls: number }[] = [];
  let visited = 0;

  for (const theme of THEMES) {
    await page.addInitScript(`try{localStorage.setItem("theme",${JSON.stringify(theme)})}catch(e){}`);
    for (const p of PAGES) {
      await page.goto(p, { waitUntil: 'domcontentloaded' });
      /* The header is server-rendered, so waiting on it rather than on a
         network condition; `networkidle` never settles on the chart pages. */
      await page.waitForSelector('[data-region="page-header"], main', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);

      const found = await page.evaluate(() => {
        const out: { tag: string; text: string; actionId: string | null; slot: string | null; region: string }[] = [];
        const regions = Array.from(document.querySelectorAll('[data-region$="-actions"], [data-region="page-actions"]'));
        for (const r of regions) {
          const region = r.getAttribute('data-region') || '';
          for (const el of Array.from(r.querySelectorAll('button, a[href], [role="button"]'))) {
            /* Only the outermost control: a button with an icon span inside is
               one control, not two, and `role="button"` on a wrapper would
               otherwise double-count its own child. */
            if (el.parentElement && el.parentElement.closest('button, a[href], [role="button"]')) continue;
            out.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
              actionId: el.getAttribute('data-action'),
              slot: el.getAttribute('data-cc-slot'),
              region,
            });
          }
        }
        return { regions: regions.length, controls: out };
      });

      visited++;
      coverage.push({ path: p, regions: found.regions, controls: found.controls.length });
      for (const c of found.controls) controls.push({ path: p, ...c });
    }
  }

  expect(visited, 'pages actually visited').toBe(PAGES.length * THEMES.length);

  /* A run that found no action regions at all would satisfy both assertions
     below vacuously, which is the failure mode this spec exists to avoid. */
  const withRegions = coverage.filter((c) => c.regions > 0);
  expect(withRegions.length, 'pages that rendered at least one action region').toBeGreaterThan(PAGES.length / 2);
  expect(controls.length, 'action controls found across the sweep').toBeGreaterThan(10);

  const tagged = controls.filter((c) => c.actionId !== null);
  const untagged = controls.filter((c) => c.actionId === null);

  const report = {
    generatedAt: new Date().toISOString(),
    registrySize: ACTIONS.length,
    coverage,
    tagged,
    untagged,
    /* Registry ids that no page in PAGES rendered. Not a failure -- several
       live behind a tab or a permission -- but a long list means a theme rule
       written against one of them was never exercised here. */
    unseen: ACTIONS.filter((id) => !tagged.some((c) => c.actionId === id)),
  };
  fs.writeFileSync(path.join(__dirname, 'fixtures', '.action-inventory.json'), JSON.stringify(report, null, 2));

  console.log(`\naction controls: ${controls.length}  tagged: ${tagged.length}  untagged: ${untagged.length}`);
  console.log(`registry ids never rendered: ${report.unseen.join(', ') || 'none'}`);
  untagged.slice(0, 40).forEach((c) => console.log(`  UNTAGGED  ${c.path}  <${c.tag}> "${c.text}"  region=${c.region}`));

  /* (1) Every data-action in the DOM is a registry id. */
  const unknown = tagged.filter((c) => !isActionId(c.actionId as string));
  expect(
    unknown.map((c) => `  ${c.path}  <${c.tag}> "${c.text}"  data-action="${c.actionId}" is not in ACTIONS`).join('\n') ||
      'none',
    'a data-action that is not in the registry matches no theme rule and is a silent no-op'
  ).toBe('none');

  /* (2) The primary slot always carries one. */
  const primaryUntagged = untagged.filter((c) => c.slot === 'primary');
  expect(
    primaryUntagged.map((c) => `  ${c.path}  <${c.tag}> "${c.text}"  has data-cc-slot="primary" and no data-action`).join('\n') ||
      'none',
    'a primary action a theme cannot name cannot be hidden by a theme'
  ).toBe('none');
});
