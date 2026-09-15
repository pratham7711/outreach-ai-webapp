/**
 * Moves inline `fontSize:` / `fontWeight:` literals onto the --cc-t-* ladder.
 *
 *   node scripts/layout/type-ladder.mjs [--write]
 *
 * WHY THIS EXISTS. The creatorcore theme could not reach the type on its own
 * pages. A census of 23 paired surfaces at desktop-1600 measured their body
 * copy at 15px/400 against ours at 13px/400, and their section headings at
 * 18px/700 against ours at 15px/700 -- and re-pointing every --cc-fs-* token
 * in the theme moved the measured divergence by 0.001, because the pages do not
 * read those tokens. 1,552 inline fontSize literals and 783 fontWeight literals
 * do the work instead, and an inline style is the one thing a theme cannot
 * outrank.
 *
 * The ladder is named for the size each rung has in OUR themes -- --cc-t-13 is
 * 13px in light and dark. It is not a promise about creatorcore, where that
 * rung resolves to 15px. Naming by role would be better and is not available:
 * a mechanical pass over 1,449 call sites can read the size and cannot read the
 * intent, so the name states the one thing that was actually measured.
 *
 * Two exclusions, both deliberate:
 *   - Recharts `tick={{ fontSize }}` is spread onto an SVG <text> as a
 *     PRESENTATION ATTRIBUTE, and attributes do not resolve var(). Those lines
 *     are skipped; converting them would silently drop the size.
 *   - Anything outside app/(dashboard) and components: the public share report
 *     and the creator portal are their own surfaces with their own token sets
 *     (--spr-*), and neither is measured against the reference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const RUNGS = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 32, 36]);
const SKIP_LINE = /tick=\{\{|axisTick/;

const files = [
  ...globSync("app/(dashboard)/**/*.tsx"),
  ...globSync("app/(dashboard)/**/*.ts"),
  ...globSync("components/**/*.tsx"),
  ...globSync("components/**/*.ts"),
];

let sizeHits = 0, weightHits = 0, skipped = 0, touched = 0;
const byRung = {};

for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = src
    .split("\n")
    .map((line) => {
      if (SKIP_LINE.test(line)) {
        const n = (line.match(/fontSize:\s*\d/g) || []).length;
        skipped += n;
        return line;
      }
      let l = line.replace(/fontSize:\s*(\d+)\s*(?=[,}\n])/g, (m, n) => {
        const v = Number(n);
        if (!RUNGS.has(v)) return m;
        sizeHits++;
        byRung[v] = (byRung[v] || 0) + 1;
        return `fontSize: "var(--cc-t-${v})"`;
      });
      l = l.replace(/fontWeight:\s*(600|800)\s*(?=[,}\n])/g, (m, n) => {
        weightHits++;
        return `fontWeight: "var(--cc-fw-${n === "600" ? "strong" : "black"})"`;
      });
      return l;
    })
    .join("\n");
  if (out !== src) {
    touched++;
    if (WRITE) writeFileSync(f, out);
  }
}

console.log(`${WRITE ? "rewrote" : "would rewrite"} ${touched} files`);
console.log(`  fontSize   ${sizeHits} converted, ${skipped} skipped (recharts ticks)`);
console.log(`  fontWeight ${weightHits} converted`);
console.log("  by rung:", Object.fromEntries(Object.entries(byRung).sort((a, b) => b[1] - a[1])));
