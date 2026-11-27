/**
 * @jest-environment node
 *
 * No platform read may come out of Next's fetch cache.
 *
 * With `next: { revalidate }`, Next keeps one answer per exact URL and, once it
 * is stale, still returns it while it refreshes in the background. YouTube's
 * reader did this for a year: the hourly sync asks for videos in chunks and a
 * campaign refresh asks for one, so the refresh was handed a count saved the
 * last time anyone refreshed that video and wrote it over the sync's newer one.
 * Views went down on every refresh, in every YouTube campaign (2026-11-27).
 *
 * This reads the source, so it also catches a cache opt-in on a reader nobody
 * has written yet. A real need for a cached fetch goes in ALLOWED with the
 * reason, where a reviewer sees it.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";

const ROOT = process.cwd();

/** path (from the repo root) -> why that file may cache. Empty on purpose. */
const ALLOWED: Record<string, string> = {};

type Rule = { name: string; re: RegExp; where: (file: string) => boolean; ok?: (m: RegExpExecArray) => boolean };

const anywhere = () => true;
const inApp = (f: string) => f.startsWith("app/");
const inReaders = (f: string) => /^lib\/(platforms|sync|acquisition)\//.test(f);
const offValue = (v: string) => /^(0|false)$/.test(v.trim());

const RULES: Rule[] = [
  {
    name: "fetch with next.revalidate",
    re: /\bnext\s*:\s*\{[^}]*?\brevalidate\s*:\s*([^,}\s]+)/g,
    where: anywhere,
    ok: (m) => offValue(m[1]),
  },
  { name: "fetch with cache: force-cache", re: /\bcache\s*:\s*["'`]force-cache["'`]/g, where: anywhere },
  {
    name: "route segment revalidate",
    re: /export\s+const\s+revalidate\s*=\s*([^;\n]+)/g,
    where: inApp,
    ok: (m) => offValue(m[1]),
  },
  {
    name: "route segment fetchCache that caches",
    re: /export\s+const\s+fetchCache\s*=\s*["'](force-cache|default-cache|only-cache)["']/g,
    where: inApp,
  },
  { name: "route segment force-static", re: /export\s+const\s+dynamic\s*=\s*["']force-static["']/g, where: inApp },
  { name: "unstable_cache in a reader", re: /\bunstable_cache\b/g, where: inReaders },
  { name: '"use cache" in a reader', re: /["']use cache["']/g, where: inReaders },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (rel === "lib/generated" || name === "node_modules") continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

function violations(file: string, text: string): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    if (!rule.where(file)) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      if (rule.ok?.(m)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      found.push(`${file}:${line}  ${rule.name}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  return found;
}

describe("platform reads never come from Next's fetch cache", () => {
  const files = [...sourceFiles(join(ROOT, "lib")), ...sourceFiles(join(ROOT, "app"))];

  it("scans the readers", () => {
    expect(files).toContain("lib/platforms/fetchPostMetrics.ts");
    expect(files).toContain("lib/sync/syncPost.ts");
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds no cached fetch, cached route or cached reader", () => {
    const found = files
      .filter((f) => !(f in ALLOWED))
      .flatMap((f) => violations(f, readFileSync(join(ROOT, f), "utf8")));
    expect(found).toEqual([]);
  });

  it("would have caught the YouTube reader as it was", () => {
    const before = [
      "const res = await fetch(",
      "  `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,",
      "  { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() }",
      ");",
      "const r2 = await fetch(url, {",
      "  method: 'GET',",
      "  next: {",
      "    revalidate: 3600,",
      "  },",
      "});",
    ].join("\n");
    expect(violations("lib/platforms/fetchPostMetrics.ts", before)).toHaveLength(2);
  });

  it("flags the other ways in, and lets the uncached forms through", () => {
    expect(violations("lib/platforms/x.ts", 'fetch(u, { cache: "force-cache" })')).toHaveLength(1);
    expect(violations("app/api/x/route.ts", "export const revalidate = 300;")).toHaveLength(1);
    expect(violations("app/api/x/route.ts", 'export const fetchCache = "force-cache";')).toHaveLength(1);
    expect(violations("app/api/x/route.ts", 'export const dynamic = "force-static";')).toHaveLength(1);
    expect(violations("lib/sync/x.ts", 'import { unstable_cache } from "next/cache";')).toHaveLength(1);
    expect(violations("lib/sync/x.ts", '"use cache";')).toHaveLength(1);

    expect(violations("lib/platforms/x.ts", 'fetch(u, { cache: "no-store" })')).toEqual([]);
    expect(violations("lib/platforms/x.ts", "fetch(u, { next: { revalidate: 0 } })")).toEqual([]);
    expect(violations("app/api/x/route.ts", "export const revalidate = 0;")).toEqual([]);
    expect(violations("lib/reports/x.ts", 'import { unstable_cache } from "next/cache";')).toEqual([]);
  });
});
