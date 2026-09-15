/**
 * Does any fetcher still write display-rounded counts?
 *
 *   npx tsx scripts/creatorcore/audit-rounding.ts
 *   npx tsx scripts/creatorcore/audit-rounding.ts --all   # every row, not just the flags
 *
 * The bug this exists to catch is silent by construction: a rounded number is a
 * valid number, the sync succeeds, the tests pass, and the only symptom is that
 * a post with 10,294 views renders as 10,200. So it has to be measured on the
 * stored data rather than argued from the code.
 *
 * Method. Every platform that abbreviates a count for display ("12.2K") rounds
 * it to the same ladder: one decimal place, so a step of 100 between 10K and 1M,
 * 100,000 between 1M and 1B, 100,000,000 above that. A value that is a multiple
 * of its own step is ON the ladder. Exact counts land there too -- one in `step`
 * of them, by chance -- so a single row proves nothing, and the rate is what
 * carries the signal. The expected-by-chance column is that floor, computed from
 * the rows actually present (mean of 1/step), not assumed to be 1%.
 *
 * A rate near the floor means the column holds exact data. A rate far above it
 * means something upstream is reading a display string. Measured 2026-09-15 on
 * the e2e-tests branch, Instagram and YouTube post counters sat at their floor
 * while TikTok's followers were at 98.7%.
 *
 * The ladders come from lib/platforms/precision.ts -- the same module the sync
 * guards with -- so this audit cannot drift away from what the app believes.
 *
 * Read-only. Reaches Neon over HTTPS so it works with the tunnel up.
 */
import { readFileSync } from "node:fs";
import { TIKTOK_DISPLAY, YOUTUBE_SUBSCRIBERS, roundedStep } from "../../lib/platforms/precision";

const SHOW_ALL = process.argv.includes("--all");

const CONN = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
if (!CONN) throw new Error("no DATABASE_URL in .env.local");
const HOST = new URL(CONN).hostname;

async function sql<T = Record<string, string>>(query: string): Promise<T[]> {
  const res = await fetch(`https://${HOST}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": CONN!,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "false",
    },
    body: JSON.stringify({ query, params: [] }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`neon http ${res.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body).rows as T[];
}

/** One counter column, and how to reach the platform it belongs to. */
type Target = { table: string; columns: string[]; platform: string; join: string };

const TARGETS: Target[] = [
  {
    table: "Post",
    columns: ["viewsCount", "likesCount", "commentsCount", "sharesCount", "savesCount", "reachCount"],
    platform: `t."platform"::text`,
    join: `"Post" t`,
  },
  {
    table: "Creator",
    columns: ["followersCount", "averageViews"],
    platform: `t."platform"::text`,
    join: `"Creator" t`,
  },
  {
    table: "CreatorSocialAccount",
    columns: ["followersCount", "avgViews", "totalLikes", "mediaCount", "followingCount"],
    platform: `t."platform"::text`,
    join: `"CreatorSocialAccount" t`,
  },
  {
    table: "PostMetricSnapshot",
    columns: ["viewsCount", "likesCount", "sharesCount"],
    platform: `p."platform"::text`,
    join: `"PostMetricSnapshot" t JOIN "Post" p ON p.id = t."postId"`,
  },
  {
    table: "CreatorTrackerSnapshot",
    columns: ["followersCount", "avgViews"],
    platform: `c."platform"::text`,
    join: `"CreatorTrackerSnapshot" t JOIN "Creator" c ON c.id = t."creatorId"`,
  },
  {
    table: "SoundTrackerSnapshot",
    columns: ["usesCount"],
    platform: `'TIKTOK'`,
    join: `"SoundTrackerSnapshot" t`,
  },
];

type Bucket = { rows: number; display: number; sigfig: number; floor: number };

const lnGamma = (x: number): number => {
  /* Lanczos, g=7 -- enough for a binomial tail over a few thousand rows. */
  const g = [
    0.999999999999809, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  let a = g[0];
  for (let i = 1; i < 9; i++) a += g[i] / (x - 1 + i);
  const t = x - 1 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(a);
};

/** P(X >= k) for X ~ Binomial(n, p): how surprising this many on-ladder rows are. */
function tailProbability(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  let total = 0;
  for (let i = k; i <= n; i++) {
    const logPmf =
      lnGamma(n + 1) -
      lnGamma(i + 1) -
      lnGamma(n - i + 1) +
      i * Math.log(p) +
      (n - i) * Math.log(1 - p);
    total += Math.exp(logPmf);
    if (total >= 1) return 1;
  }
  return total;
}

function verdict(b: Bucket): { verdict: string; p: number } {
  /* An exact count lands on the ladder by chance about one time in `step`, so
     the question is never "is any row on the ladder" but "are more rows on it
     than chance explains". That is a binomial tail, not a multiple of the floor:
     8 of 112 is damning while 1 of 21 is nothing, and a rate-based threshold
     cannot tell those apart. */
  const p = tailProbability(b.display, b.rows, Math.max(b.floor, 1e-9));
  if (b.rows < 10 && b.display === 0) return { verdict: "too few rows", p };
  if (p > 0.01) return { verdict: "exact", p };
  return { verdict: b.display / b.rows >= 0.5 ? "ROUNDED" : "above chance", p };
}

async function main() {
  const flagged: string[] = [];

  for (const target of TARGETS) {
    const cols = target.columns.map((c) => `t."${c}"::float8 AS "${c}"`).join(", ");
    const any = target.columns.map((c) => `t."${c}" >= 10000`).join(" OR ");
    let rows: Record<string, string>[];
    try {
      rows = await sql(
        `SELECT ${target.platform} AS platform, ${cols} FROM ${target.join} WHERE ${any}`,
      );
    } catch (e) {
      console.log(`${target.table}: unreadable -- ${(e as Error).message.slice(0, 120)}\n`);
      continue;
    }

    const buckets = new Map<string, Bucket>();
    for (const row of rows) {
      for (const col of target.columns) {
        const value = Number(row[col]);
        if (!Number.isFinite(value) || value < 10_000) continue;
        const key = `${col}|${row.platform}`;
        const b = buckets.get(key) ?? { rows: 0, display: 0, sigfig: 0, floor: 0 };
        b.rows += 1;
        if (roundedStep(value, TIKTOK_DISPLAY) !== null) b.display += 1;
        if (roundedStep(value, YOUTUBE_SUBSCRIBERS) !== null) b.sigfig += 1;
        b.floor += 1 / (TIKTOK_DISPLAY(value) ?? Infinity);
        buckets.set(key, b);
      }
    }
    if (!buckets.size) continue;

    const table = [...buckets.entries()]
      .map(([key, b]) => {
        const [column, platform] = key.split("|");
        const v = verdict({ ...b, floor: b.floor / b.rows });
        return {
          column,
          platform,
          rows: b.rows,
          on_ladder: b.display,
          on_display_ladder: `${((100 * b.display) / b.rows).toFixed(1)}%`,
          on_3_sigfig: `${((100 * b.sigfig) / b.rows).toFixed(1)}%`,
          expected_by_chance: `${((100 * b.floor) / b.rows).toFixed(1)}%`,
          p_value: v.p < 1e-4 ? v.p.toExponential(1) : v.p.toFixed(4),
          verdict: v.verdict,
        };
      })
      .filter((r) => SHOW_ALL || r.verdict !== "too few rows")
      .sort((a, b) => b.rows - a.rows);

    if (!table.length) continue;
    console.log(`### ${target.table}`);
    console.table(table);
    for (const r of table) {
      if (r.verdict === "ROUNDED" || r.verdict === "above chance") {
        flagged.push(`${target.table}.${r.column} [${r.platform}] ${r.on_display_ladder} of ${r.rows}`);
      }
    }
  }

  console.log(flagged.length ? `\nFLAGGED:\n  ${flagged.join("\n  ")}` : "\nNothing above the floor.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
