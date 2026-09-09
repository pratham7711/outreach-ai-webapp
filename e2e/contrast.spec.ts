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
  '/settings/metrics',
  '/settings/general',
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

  /* The background actually behind an element: composite every translucent
     layer upward until something opaque. A background-image could be any
     colour, so those are skipped rather than scored against a guess. */
  const effectiveBg = (el: Element): C | null => {
    let acc: C | null = null;
    let node: Element | null = el;
    while (node) {
      const cs = getComputedStyle(node);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc === null ? c : over(acc, c);
        if (acc.a >= 0.999) return acc;
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      node = node.parentElement;
    }
    const white = { r: 255, g: 255, b: 255, a: 1 };
    return acc === null ? white : over(acc, white);
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
    const bg = effectiveBg(el);
    if (!bg) continue;
    const fg = fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;

    const r = ratio(fg, bg);
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
      await page.waitForTimeout(600);
      visited++;
      const rows = await page.evaluate(probe);
      for (const r of rows) findings.push({ theme, path: p, ...r });
    }
  }

  /* An empty result is only good news if the pages actually loaded. Without
     this, an unreachable server reports a spotless UI. */
  expect(visited, 'pages actually visited').toBe(attempted);

  const invisible = findings.filter((f) => f.severity === 'INVISIBLE');
  const aaFails = findings.filter((f) => f.severity === 'aa-fail');

  const report = { generatedAt: new Date().toISOString(), visited, invisible, aaFails };
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
