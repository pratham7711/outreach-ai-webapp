import { platformBrandColor } from "@/lib/platforms/registry";

/**
 * The client report's platform colours: each platform's own colour, as fixed
 * hex, shared by the Views Over Time stack and the Views by Platform pie so a
 * platform is the same colour in both.
 *
 * The pie used to take the app's --chart-N tokens, which follow the viewer's
 * theme. Both themes a client can land in are greyscale, and Dark's are light
 * greys for a dark card, so on the report's white card a phone in dark mode
 * drew TikTok at #F5F5F5 (1.09:1) and the slice and its tooltip disappeared.
 * The stack beside it was a fixed grey ramp copied from the reference report,
 * which left the two charts encoding the same platforms differently.
 *
 * A brand colour gives way where it would not read as its own band: under 3:1
 * against the white card (Snapchat's yellow), or too close to a colour another
 * platform already took (TikTok's black beside X's).
 *
 * "Too close" is measured, not eyeballed: OKLab distance x100 under normal
 * vision and under protan and deutan simulation (Machado 2009, severity 1).
 * It used to be a plain RGB distance of 60, which passed Instagram's pink
 * beside YouTube's red (RGB 118, but OKLab 8.2 -- two reds a client could not
 * tell apart in the stack), and passed the grey that replaced a clashing
 * colour although protan readers saw it at 2.4 from Instagram's pink.
 */
const PIE_CARD = "#FFFFFF";
/**
 * Stand-ins for a platform that cannot keep a brand colour, tried in order:
 * greys first, then Okabe-Ito hues. Every one clears 3:1 on the white card.
 * Under that floor only two greys stand 15 apart from each other and from
 * TikTok's black (#8A8A8A, once here, is 9.5 from #6E6E6E), so TikTok, X and
 * Threads together used them up and Snapchat fell back to its own yellow at
 * 1.07:1. The hues are what a fourth neutral-brand platform takes instead.
 */
const PIE_FALLBACKS = ["#6E6E6E", "#3D3D3D", "#949494", "#0072B2", "#009E73", "#D55E00", "#CC79A7"] as const;
const MIN_SLICE_CONTRAST = 3;
/** Neighbours under normal vision: below 15 two colours read as one. */
const MIN_NORMAL_DELTA = 15;
/** Neighbours under red-green colour blindness. */
const MIN_CVD_DELTA = 8;

/**
 * Where the report draws a platform in the app's chart colour rather than its
 * brand colour, so the client sees the colour the agency sees.
 *
 * Instagram is the dashboard's pink, --cc-cat-2 in the light and dark themes
 * (app/globals.css), not its brand #E4405F. That pink sat 8.2 from YouTube's
 * red, so Instagram turned purple on this report whenever YouTube was in it,
 * and pink on the dashboard. #CC79A7 is 20 from YouTube's red, at least 14
 * under protan and deutan from every other platform's colour, and 3.06:1 on
 * the white card.
 */
const CHART_COLORS: Partial<Record<string, string>> = {
  INSTAGRAM: "#CC79A7",
};

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function linear(hex: string): [number, number, number] {
  return rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const CVD: Record<"protan" | "deutan", number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
};

function oklab([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function seenAs(hex: string, kind?: keyof typeof CVD): number[] {
  const c = linear(hex);
  if (!kind) return c;
  return CVD[kind].map((row) => Math.max(0, Math.min(1, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
}

/** OKLab distance x100 between two colours, as seen with normal vision or the given colour blindness. */
export function chartDelta(a: string, b: string, kind?: keyof typeof CVD): number {
  const [x, y] = [oklab(seenAs(a, kind)), oklab(seenAs(b, kind))];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

function distinct(a: string, b: string): boolean {
  return (
    chartDelta(a, b) >= MIN_NORMAL_DELTA &&
    chartDelta(a, b, "protan") >= MIN_CVD_DELTA &&
    chartDelta(a, b, "deutan") >= MIN_CVD_DELTA
  );
}

/** How much of the colour a band keeps over the white card, lightest first; 1 is the colour itself. */
const BAND_STRENGTHS = [0.6, 0.7, 0.8, 0.9, 1] as const;

function tint(hex: string, strength: number): string {
  return `#${rgb(hex)
    .map((c) => Math.round(strength * c + (1 - strength) * 255).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

/**
 * The stacked chart's band fills, one per colour: each colour lightened toward
 * the white card, by the most that still leaves every pair of bands distinct.
 * Three solid blocks -- YouTube's pure red over Instagram's pink under
 * TikTok's black -- read as a poster rather than a chart; the band's edge is
 * drawn in the colour itself, so identity stays with the platform's colour.
 *
 * Lightening pulls colours together, so the step is chosen per chart, not
 * fixed. Colours that are too close at full strength come back unchanged.
 */
export function bandFillsFor(colors: string[]): string[] {
  for (const strength of BAND_STRENGTHS) {
    const fills = colors.map((hex) => tint(hex, strength));
    if (fills.every((a, i) => fills.every((b, j) => j <= i || distinct(a, b)))) return fills;
  }
  return colors;
}

/** a beats b: compared position by position, the first difference decides. */
function ahead(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > (b[i] ?? -1);
  return false;
}

/**
 * One colour per platform, in the order given; give the order by views.
 *
 * Of every way to give platforms their own colours with no two too close, this
 * keeps the one that leaves the most platforms in their own colours; between
 * equals, the one that keeps the bigger platform's. A greedy pass could not see
 * past the first clash, and greyed out the biggest platform when a smaller one
 * had taken a colour near its own.
 * Whatever is left takes the first stand-in that stands apart from everything
 * chosen, or failing that the one furthest from it; never a colour under 3:1.
 * Search is over at most a few platforms with one colour each.
 */
export function platformColorsFor(platforms: string[]): string[] {
  const own = platforms.map((p) => (CHART_COLORS[p.toUpperCase()] ?? platformBrandColor(p)).toUpperCase());
  const options = own.map((hex) => [hex].filter((h) => contrast(h, PIE_CARD) >= MIN_SLICE_CONTRAST));

  let best: (string | undefined)[] = platforms.map(() => undefined);
  let bestScore: number[] = [];
  const picked: (string | undefined)[] = [];
  const visit = (i: number) => {
    if (i === platforms.length) {
      const kept = picked.map((hex): number => (hex ? 1 : 0));
      const score = [kept.reduce((a, b) => a + b, 0), ...kept];
      if (ahead(score, bestScore)) {
        bestScore = score;
        best = [...picked];
      }
      return;
    }
    for (const hex of options[i]) {
      if (picked.every((t) => t === undefined || distinct(hex, t))) {
        picked.push(hex);
        visit(i + 1);
        picked.pop();
      }
    }
    picked.push(undefined);
    visit(i + 1);
    picked.pop();
  };
  visit(0);

  const taken = best.filter((hex): hex is string => hex !== undefined);
  return best.map((hex) => {
    if (hex) return hex;
    const free = PIE_FALLBACKS.filter((f) => !taken.includes(f));
    const nearest = (f: string) => Math.min(...taken.map((t) => chartDelta(f, t)));
    const pick =
      free.find((f) => taken.every((t) => distinct(f, t))) ??
      free.reduce((a, b) => (nearest(b) > nearest(a) ? b : a), free[0] ?? PIE_FALLBACKS[0]);
    taken.push(pick);
    return pick;
  });
}
