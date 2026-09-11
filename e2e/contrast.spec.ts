import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/**
 * Cross-theme text-contrast guard.
 *
 * A rule like `color: #FFFFFF` is not a bug on its own -- it is a bug only in
 * combination with whatever is painted behind it, and that combination exists
 * only at runtime. Grepping the stylesheets cannot see it; this walks the real
 * pages in every theme and composites the actual background through every
 * transparent ancestor.
 *
 * Written after the campaigns filter strip shipped its selected "Active" tab as
 * white-on-near-white: the status style's `color` is the text colour for that
 * status's own solid-blue chip, and the tab painted it straight onto the page,
 * so the label, its underline and its icon were all invisible.
 */

const THEMES = ['light', 'dark', 'creatorcore'] as const;

const PAGES = [
  '/dashboard',
  '/campaigns',
  /* Selected explicitly: a status tab only paints its status colour when it is
     the active one, so the white-on-white "Active" tab that prompted this spec
     is invisible to a plain /campaigns visit. */
  '/campaigns?status=IN_PROGRESS',
  '/campaigns?status=COMPLETE',
  '/creators',
  '/clients',
  '/analytics',
  '/payouts',
  '/lists',
  '/discovery',
  '/settings',
  '/settings/general',
  /* The campaign detail tabs. The post grid is the reason these are here: its
     cards paint the counts on an overlay above the thumbnail, which is the one
     surface on the app that cannot take its ground from the theme, and none of
     the list pages above reach it. viewMode defaults to "grid", so the card
     overlay renders on a plain visit. */
  '/campaigns/camp-1?tab=posts',
  '/campaigns/camp-1?tab=overview',
  '/campaigns/camp-1?tab=creators',
  '/campaigns/camp-1?tab=analytics',
  '/connections',
];

/** Below this nothing is readable at any size or weight. */
const INVISIBLE = 3.0;
/** WCAG AA for normal-size text. */
const AA = 4.5;

type Finding = {
  theme: string;
  path: string;
  sel: string;
  text: string;
  ratio: number;
  color: string;
  bg: string;
  size: number;
  weight: number;
  severity: 'INVISIBLE' | 'aa-fail';
};

function probe() {
  const parseColor = (s: string) => {
    const m = String(s).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  type C = { r: number; g: number; b: number; a: number };
  const over = (fg: C, bg: C): C => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c: C) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a: C, b: C) => {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  /* Every background an element might actually be sitting on, compositing each
     translucent layer upward until something opaque.
     A gradient is not skipped. It used to be -- anything with a
     background-image returned null -- and that is precisely how the post
     card's counts stayed invisible through a green run of this spec: the
     panel behind them is a linear-gradient, so the one element that was
     broken was the one element never scored. A gradient resolves to a known
     set of colours, so each stop becomes its own candidate ground and the
     text is judged against the worst of them.
     A url() bitmap genuinely could be any colour and is still skipped, since
     scoring against a guess would report findings nobody can act on. */
  const MAX_CANDIDATES = 24;
  const effectiveBgs = (el: Element): C[] | null => {
    /* Candidates that have reached full opacity and need no more ancestors. */
    const settled: C[] = [];
    /* Candidates still translucent, so still looking for something behind. */
    let accs: (C | null)[] = [null];

    const combine = (alternatives: C[]) => {
      const next: (C | null)[] = [];
      for (const acc of accs) {
        for (const alt of alternatives) next.push(acc === null ? alt : over(acc, alt));
      }
      accs = next.slice(0, MAX_CANDIDATES);
    };

    let node: Element | null = el;
    let hitArtwork = false;
    while (node) {
      const cs = getComputedStyle(node);

      /* Front to back within one element: the background-image paints over
         the background-color, and both paint over whatever the ancestors
         put down. */
      const bi = cs.backgroundImage;
      if (bi && bi !== 'none') {
        // getComputedStyle has already resolved var() and color-mix() here,
        // so the stops arrive as plain rgb()/rgba().
        const stops = (bi.match(/rgba?\([^)]*\)/g) || [])
          .map(parseColor)
          .filter((c): c is C => c !== null && c.a > 0);
        if (/url\(/i.test(bi) || !stops.length) {
          /* A bitmap could be any colour. Whatever is already opaque is still
             a real ground and is kept -- this is the post card exactly: the
             counts sit on the solid end of a gradient, which is scoreable,
             while the same panel's transparent end sits on the thumbnail,
             which is not. Bailing outright on the whole element is what let
             the white-on-white counts through. */
          hitArtwork = true;
          break;
        }
        combine(stops);
      }
      const bc = parseColor(cs.backgroundColor);
      if (bc && bc.a > 0) combine([bc]);

      const stillLooking: (C | null)[] = [];
      for (const a of accs) {
        if (a !== null && a.a >= 0.999) settled.push(a);
        else stillLooking.push(a);
      }
      accs = stillLooking;
      if (!accs.length) return settled;
      node = node.parentElement;
    }

    if (hitArtwork) return settled.length ? settled : null;
    /* Walked past the root without meeting artwork: the page itself is white. */
    const white = { r: 255, g: 255, b: 255, a: 1 };
    return settled.concat(accs.map((a) => (a === null ? white : over(a, white))));
  };

  const out: Omit<Finding, 'theme' | 'path'>[] = [];
  const seen = new Set<string>();

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent || '').trim())
      .join(' ')
      .trim();
    if (!own) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity) < 0.15) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;

    const fgRaw = parseColor(cs.color);
    if (!fgRaw) continue;
    const bgs = effectiveBgs(el);
    if (!bgs || !bgs.length) continue;

    /* Worst ground wins. A gradient panel is only as readable as its least
       readable stop -- text that clears AA at the top of the ramp and
       disappears at the bottom is still unreadable text. */
    let bg = bgs[0];
    let fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
    let r = ratio(fg, bg);
    for (const cand of bgs.slice(1)) {
      const f = fgRaw.a < 1 ? over(fgRaw, cand) : fgRaw;
      const rr = ratio(f, cand);
      if (rr < r) { r = rr; fg = f; bg = cand; }
    }
    if (r >= 4.5) continue;

    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700);
    if (isLarge && r >= 3.0) continue;

    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    const sel = el.tagName.toLowerCase() + cls;
    const key = sel + '|' + own.slice(0, 40) + '|' + Math.round(r * 10);
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      sel,
      text: own.slice(0, 60),
      ratio: Math.round(r * 100) / 100,
      color: cs.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      size,
      weight,
      severity: r < 3.0 ? 'INVISIBLE' : 'aa-fail',
    });
  }
  return out;
}

test('no invisible text in any theme', async ({ page }) => {
  test.setTimeout(600000);

  const findings: Finding[] = [];
  /* What each visit actually had to score. A contrast sweep over a page that
     never finished loading is the failure mode this spec is most exposed to:
     it passes, it looks thorough, and it proves nothing. */
  const coverage: { theme: string; path: string; textNodes: number; overlaysWithText: number; skeletons: number }[] = [];
  let visited = 0;
  let attempted = 0;

  for (const theme of THEMES) {
    for (const p of PAGES) {
      attempted++;
      await page.goto(p, { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => {
        localStorage.setItem('theme', t);
        document.documentElement.classList.remove('light', 'dark', 'creatorcore');
        if (t !== 'light') document.documentElement.classList.add(t);
      }, theme);
      // Re-render under the theme class rather than trusting a class swap to
      // restyle everything already painted.
      await page.reload({ waitUntil: 'domcontentloaded' });

      /* Wait for content, not for a stopwatch. The old fixed 600ms was the
         hole that let the post card through: that tab is still a grid of
         .ui-skeleton shimmers at 2.5s and only paints its cards near 12s, so
         the probe was scoring placeholder boxes and reporting a clean page.
         Skeletons carry .ui-skeleton from @pratham7711/ui, so their absence is
         the honest ready signal. */
      /* Network first: the skeleton count is not monotonic -- measured on the
         posts tab it goes 7 at 1s, 30 at 4s as the second wave mounts, 0 at
         6s -- so waiting for the first zero can land in a gap between waves. */
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await page
        .waitForFunction(() => document.querySelectorAll('.ui-skeleton').length === 0, null, {
          timeout: 30000,
        })
        .catch(() => {
          /* Left spinning: recorded below as too little content rather than
             silently accepted. */
        });
      await page.waitForTimeout(400);
      visited++;

      coverage.push({
        theme,
        path: p,
        ...(await page.evaluate(() => {
          let textNodes = 0;
          let overlaysWithText = 0;
          for (const el of Array.from(document.querySelectorAll('body *'))) {
            const hasOwnText = Array.from(el.childNodes).some(
              (n) => n.nodeType === 3 && (n.textContent || '').trim()
            );
            if (!hasOwnText) continue;
            textNodes++;
            /* The gradient is on the panel, never on the element holding the
               text -- the counts are separate child rows inside it. So this
               asks whether the text SITS ON an overlay, walking the same
               chain effectiveBgs walks; asking whether the text-bearing
               element is itself the gradient answers 0 every time. */
            for (let n: Element | null = el; n; n = n.parentElement) {
              if ((getComputedStyle(n).backgroundImage || '').includes('gradient')) {
                overlaysWithText++;
                break;
              }
            }
          }
          return { textNodes, overlaysWithText, skeletons: document.querySelectorAll('.ui-skeleton').length };
        })),
      });

      const rows = await page.evaluate(probe);
      for (const r of rows) findings.push({ theme, path: p, ...r });
    }
  }

  /* An empty result is only good news if the pages actually loaded. Without
     this, an unreachable server reports a spotless UI. */
  expect(visited, 'pages actually visited').toBe(attempted);

  /* ...and only if each page had something to score. A page still showing
     skeletons yields a handful of nav labels and no content, which is
     indistinguishable from a clean page in the findings list. */
  const thin = coverage.filter((c) => c.textNodes < 25 || c.skeletons > 0);
  expect(
    thin.map((c) => `  [${c.theme}] ${c.path}  ${c.textNodes} text nodes, ${c.skeletons} skeletons still up`).join('\n') ||
      'none',
    'every page must finish loading before it is scored'
  ).toBe('none');

  /* The post grid specifically. Its counts sit on a gradient overlay, the one
     surface that has to carry its own ground, and it is the surface this spec
     used to miss entirely -- so its presence is asserted rather than assumed. */
  const postGrid = coverage.filter((c) => c.path.includes('tab=posts'));
  expect(postGrid.length, 'the post grid is in PAGES').toBeGreaterThan(0);
  for (const c of postGrid) {
    expect(c.overlaysWithText, `[${c.theme}] ${c.path} rendered post-card overlays`).toBeGreaterThan(0);
  }

  const invisible = findings.filter((f) => f.severity === 'INVISIBLE');
  const aaFails = findings.filter((f) => f.severity === 'aa-fail');

  const report = { generatedAt: new Date().toISOString(), visited, coverage, invisible, aaFails };
  const out = path.join(__dirname, 'fixtures', '.contrast-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  const fmt = (f: Finding) =>
    `  ${f.ratio.toFixed(2)}:1  [${f.theme}] ${f.path}  ${f.sel}  "${f.text}"  ${f.color} on ${f.bg}`;
  console.log(`\nINVISIBLE (<${INVISIBLE}:1): ${invisible.length}`);
  invisible.slice(0, 40).forEach((f) => console.log(fmt(f)));
  console.log(`\nAA fails (${INVISIBLE}-${AA}:1): ${aaFails.length}`);
  aaFails.slice(0, 30).forEach((f) => console.log(fmt(f)));

  expect(
    invisible.map(fmt).join('\n') || 'none',
    'text below 3:1 is unreadable at any size'
  ).toBe('none');
});
