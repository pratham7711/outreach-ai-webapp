/* The landing hero's demo series, shared by the figure (KPIs, caption) and the
   chart, which is loaded separately so recharts stays out of the page's first
   load. Invented numbers, labelled "Demo data" wherever they appear. */

export type Platform = "tiktok" | "instagram" | "youtube";
export type Filter = "all" | Platform;

export const PLATFORMS: { key: Platform; label: string; tone: string; color: string; posts: number; engagements: number }[] = [
  { key: "tiktok", label: "TikTok", tone: "lp-tone-blue", color: "var(--cc-landing-tiktok)", posts: 8, engagements: 96000 },
  { key: "instagram", label: "Instagram", tone: "lp-tone-pink", color: "var(--cc-landing-instagram)", posts: 5, engagements: 38400 },
  { key: "youtube", label: "YouTube", tone: "lp-tone-orange", color: "var(--cc-landing-youtube)", posts: 2, engagements: 15600 },
];

const VIEWS: Record<Platform, number[]> = {
  tiktok: [20000, 60000, 130000, 220000, 330000, 450000, 560000, 670000, 770000, 860000, 950000, 1040000, 1120000, 1160000, 1200000],
  instagram: [10000, 30000, 60000, 100000, 140000, 190000, 230000, 270000, 310000, 350000, 390000, 420000, 450000, 465000, 480000],
  youtube: [0, 10000, 20000, 40000, 60000, 80000, 100000, 130000, 150000, 180000, 200000, 220000, 240000, 250000, 260000],
};

export const DATA = VIEWS.tiktok.map((_, i) => ({
  day: i + 1,
  tiktok: VIEWS.tiktok[i],
  instagram: VIEWS.instagram[i],
  youtube: VIEWS.youtube[i],
}));

export const DAYS = DATA.length;
export const TICKS_WIDE = DATA.filter((d) => d.day % 2 === 1).map((d) => d.day);
export const TICKS_NARROW = [1, 8, 15];
export const AXIS = { fontSize: 12, fill: "var(--cc-landing-muted)" } as const;

export function lastViews(key: Platform): number {
  return VIEWS[key][VIEWS[key].length - 1];
}
