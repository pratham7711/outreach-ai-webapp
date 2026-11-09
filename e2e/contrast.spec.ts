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

const THEMES = ['light', 'dark'] as const;

/* One worker per theme. The two tests share nothing at runtime -- each has
   its own browser context, so its own localStorage, and writes its own
   .contrast-report.<theme>.json -- but the config runs a file's tests on one
   worker, so this file alone took 365s of a 377s test span (MEASURED,
   2026-10-13: 2.2m + 2.0m + 2.0m back to back) and nothing else could finish
   before it did. In parallel the floor is the slowest theme, not their sum.
   The one shared write is the baseline file, read-modify-written by each test
   under CONTRAST_BASELINE=write; two themes doing that at once would each keep
   only their own part, so a write run stays on one worker. */
test.describe.configure({ mode: process.env.CONTRAST_BASELINE === 'write' ? 'default' : 'parallel' });

const PAGES = [
  '/dashboard',
  '/campaigns',
  /* Selected explicitly: a status tab only paints its status colour when it is
     the active one, so the white-on-white "Active" tab that prompted this spec
     is invisible to a plain /campaigns visit. */
  '/campaigns?status=IN_PROGRESS',
  '/campaigns?status=COMPLETE',
  '/creators',
  '/analytics',
  '/lists',
  '/settings',
  '/settings/general',
  /* /settings/team and /requests carry the amber status pill -- a #D97706 ink
     on a #FEF3C7 ground, the same hue twice, measuring 2.86:1. That is below
     this file's own INVISIBLE floor, yet the suite stayed green for as long as
     the pill existed: the route list stopped at /settings/general, so no run
     ever loaded a page that renders one. The design critic found it from a
     screenshot capture instead, which is the wrong side of the loop to be
     catching a WCAG failure on. A guard is only worth its floor on the routes
     it actually visits. */
  '/settings/team',
  /* The campaign detail tabs. The post grid is the reason these are here: its
     cards paint the counts on an overlay above the thumbnail, which is the one
     surface on the app that cannot take its ground from the theme, and none of
     the list pages above reach it. viewMode defaults to "grid", so the card
     overlay renders on a plain visit. */
  '/campaigns/camp-1?tab=posts',
  '/campaigns/camp-1?tab=overview',
  '/campaigns/camp-1?tab=creators',
  '/campaigns/camp-1?tab=analytics',
  /* Every other page the sidebar keeps (plan §03: "extended to every kept
     page"), and the detail pages a list row or roster row opens. */
  '/songs',
  '/calendar',
  '/trackers',
  '/creators/creator-1',
  '/settings/trackers',
  '/settings/api-keys',
  '/settings/ingestion',
];

/** Below this nothing is readable at any size or weight. */
const INVISIBLE = 3.0;
/** WCAG AA for normal-size text. */
const AA = 4.5;

/**
 * Chrome does not serialise a colour the way it was written: a color-mix() comes
 * back as `color(srgb 0.905882 0.678431 0)` and a hex as `rgb(231, 173, 0)`, so
 * a recorded pair can only be matched on the composited value. Rounded to whole
 * channels because those floats carry 1/255 rounding of their own.
 */
function inkKey(value: string): string {
  const str = String(value).trim();
  let r: number, g: number, b: number, a = 1;
  const srgb = str.match(/^color\(\s*srgb\s+([^)]+)\)/i);
  if (srgb) {
    const [rgbPart, alphaPart] = srgb[1].split('/');
    const p = rgbPart.trim().split(/\s+/).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return `raw:${str}`;
    [r, g, b] = [p[0] * 255, p[1] * 255, p[2] * 255];
    if (alphaPart !== undefined) a = parseFloat(alphaPart);
  } else {
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return `raw:${str}`;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some((n) => Number.isNaN(n))) return `raw:${str}`;
    [r, g, b] = [p[0], p[1], p[2]];
    if (p.length > 3) a = p[3];
  }
  if (Number.isNaN(a)) a = 1;
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 100) / 100].join(',');
}

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
    const str = String(s).trim();
    /* Chrome serialises a color-mix() result as `color(srgb 0.8 0.185 0.151)`
       -- space separated, 0-1 floats, optional `/ alpha` -- never as rgb().
       Returning null for that form is NOT a harmless miss here: the caller
       reads null as "transparent", walks to the parent, and scores the ink
       against whatever paints higher up. That reported the notification badge
       as white-on-white 1:1 on 34 routes while it actually measures 5.24:1 in
       the browser -- a failure this suite is specifically meant to catch, on an
       element that was never broken. */
    const fn = str.match(/^color\(\s*srgb\s+([^)]+)\)/i);
    if (fn) {
      const [rgbPart, alphaPart] = fn[1].split('/');
      const p = rgbPart.trim().split(/\s+/).map((x) => parseFloat(x));
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
      const a = alphaPart !== undefined ? parseFloat(alphaPart) : 1;
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: Number.isNaN(a) ? 1 : a };
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map((x) => parseFloat(x.trim()));
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

/**
 * The ratchet (plan §03, §12). Light and Dark answer to WCAG AA, 4.5:1, but on
 * the day the floor moved from 3:1 they failed 196 and 154 checks -- so the
 * AA failures that exist are recorded here as debt, keyed by page, element and
 * the colour PAIR (not the text, which carries counts and dates and would make
 * every key flaky). A pair that is not in the file fails the run: no new debt.
 * A recorded pair that no longer occurs also fails, so the file only shrinks --
 * delete the line, or rewrite it with CONTRAST_BASELINE=write after a fix.
 */
const BASELINE_FILE = path.join(__dirname, 'fixtures', 'contrast-baseline.json');
type Baseline = { light: string[]; dark: string[] };

function readBaseline(): Baseline | null {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as Baseline;
  } catch {
    return null;
  }
}

const debtKey = (f: Finding) => `${f.path}  ${f.sel}  ${inkKey(f.color)} on ${inkKey(f.bg)}`;

/**
 * Wait until nothing on the page is mid-animation, then one more frame.
 *
 * This replaced a flat 400ms after the content waits. What the probe is
 * exposed to is an element caught part-way through a fade: below 0.15 opacity
 * it is skipped as invisible, so a finding drops out of one run and back into
 * the next, and the two-way ratchet reads that as debt fixed or debt added.
 * CSS transitions, CSS animations and framer-motion's opacity fades (it runs
 * opacity through the Web Animations API) all appear in getAnimations(), so
 * "none still running" is the condition the sleep was standing in for.
 * Infinite ones -- spinners, skeleton shimmer -- never finish and never fade
 * text, so they do not count. Bounded, like the old sleep was: a page that
 * keeps animating is scored as it stands rather than failing the sweep.
 */
async function settled(page: import('@playwright/test').Page) {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          if (a.playState !== 'running') return true;
          return a.effect?.getComputedTiming().iterations === Infinity;
        }),
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())));
}

async function sweep(page: import('@playwright/test').Page, theme: (typeof THEMES)[number]) {
  const findings: Finding[] = [];
  /* What each visit actually had to score. A contrast sweep over a page that
     never finished loading is the failure mode this spec is most exposed to:
     it passes, it looks thorough, and it proves nothing. */
  const coverage: { theme: string; path: string; textNodes: number; overlaysWithText: number; skeletons: number }[] = [];
  let visited = 0;
  let attempted = 0;

  /* The theme is in localStorage before any of the page's own scripts run, so
     next-themes' boot script paints every page in it from the first frame.
     This used to load each page, set the theme, then reload it -- two full
     page loads per route, 23 routes, every theme -- and the first load was
     thrown away every time. The reload was there so nothing already painted
     kept the old theme's colours; a first paint in the right theme gives the
     same guarantee without the throwaway load, and the class check below
     proves it took rather than trusting it. */
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t);
    } catch {
      /* about:blank has no storage; every real page does. */
    }
  }, theme);

  for (const p of PAGES) {
    attempted++;
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.className), {
        message: `${p} should render in the ${theme} theme`,
        timeout: 10000,
      })
      .toMatch(new RegExp(`(^|\\s)${theme}(\\s|$)`));

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
    await settled(page);
    /* /analytics opens on the last 30 days, so what it draws depends on the
       seed's age: CI seeds fresh and gets the figure tiles, a test database
       seeded weeks ago gets "Nothing published in this range". The two then
       record different pairs and the two-way ratchet cannot hold for both.
       "All" takes the seed's age out of it. */
    if (p === '/analytics') {
      /* The click only schedules the refetch, so networkidle and a zero
         skeleton count can both read true before it starts: MEASURED, both
         waits returned at 441ms against a response at 774ms, and the sweep
         scored the loading grid. Wait for the response itself. */
      await Promise.all([
        page
          .waitForResponse((r) => r.url().includes('/api/analytics') && !r.url().includes('from='), { timeout: 30000 })
          .catch(() => {}),
        page.getByRole('group', { name: 'Date range' }).getByRole('button', { name: 'All', exact: true }).click(),
      ]);
      await page
        .waitForFunction(() => document.querySelectorAll('.ui-skeleton').length === 0, null, { timeout: 30000 })
        .catch(() => {});
      await settled(page);
    }
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
  const report = { generatedAt: new Date().toISOString(), theme, visited, coverage, invisible, aaFails };
  fs.writeFileSync(path.join(__dirname, 'fixtures', `.contrast-report.${theme}.json`), JSON.stringify(report, null, 2));
  return { invisible, aaFails };
}

const fmt = (f: Finding) =>
  `  ${f.ratio.toFixed(2)}:1  [${f.theme}] ${f.path}  ${f.sel}  "${f.text}"  ${f.color} on ${f.bg}`;

/** Writes this theme's part of the baseline when asked to, and only then. */
function writeBaseline(part: Partial<Baseline>) {
  if (process.env.CONTRAST_BASELINE !== 'write') return false;
  const current = readBaseline() ?? { light: [], dark: [] };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify({ ...current, ...part }, null, 2) + '\n');
  return true;
}

for (const theme of THEMES) {
  test(`contrast: ${theme} -- nothing under 3:1, and no new pair under 4.5:1`, async ({ page }) => {
    test.setTimeout(600000);
    const { invisible, aaFails } = await sweep(page, theme);

    console.log(`\n[${theme}] INVISIBLE (<${INVISIBLE}:1): ${invisible.length}`);
    invisible.slice(0, 40).forEach((f) => console.log(fmt(f)));
    console.log(`[${theme}] AA fails (${INVISIBLE}-${AA}:1): ${aaFails.length}`);

    /* The floor. Every colour in a theme is ours to choose, so one that cannot
       be read is our bug. */
    expect(invisible.map(fmt).join('\n') || 'none', 'text below 3:1 is unreadable at any size').toBe('none');

    const keys = [...new Set(aaFails.map(debtKey))].sort();
    if (writeBaseline({ [theme]: keys })) return;

    const recorded = new Set(readBaseline()?.[theme] ?? []);
    const fresh = aaFails.filter((f) => !recorded.has(debtKey(f)));
    expect(
      [...new Set(fresh.map(fmt))].join('\n') || 'none',
      `new text under ${AA}:1 in ${theme}: fix it with a token, not a baseline line`
    ).toBe('none');

    const seen = new Set(keys);
    const fixed = [...recorded].filter((k) => !seen.has(k));
    expect(
      fixed.join('\n') || 'none',
      `these ${theme} pairs no longer occur -- remove them from e2e/fixtures/contrast-baseline.json so the ratchet holds`
    ).toBe('none');
  });
}
