/**
 * Hoists the panel-title inline style onto a class the theme can reach.
 *
 *   node scripts/layout/panel-title.mjs [--write]
 *
 * The same three declarations -- `fontWeight: 700`, `fontSize:
 * "var(--cc-t-15)"`, `color: "var(--cc-text)"` -- appear verbatim on 30 span
 * elements across the dashboard, each one a card's or a section's heading. An
 * inline style is the one thing a theme cannot outrank, so none of them could
 * be re-pointed: MEASURED at desktop-1600, the reference's chart headings are
 * 18px/700 CENTRED over the chart and its section headings are 18px/700 left,
 * while every one of ours rendered left at whatever --cc-t-15 resolves to.
 *
 * Only those three declarations move. Whatever else the style carries --
 * `display: block`, a `marginBottom`, a flex row for a heading with a chip in
 * it -- is layout that differs per call site and stays exactly where it is.
 * The class then owns type, colour and alignment through --cc-panel-title-*,
 * whose base values restate what the inline style did.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const WRITE = process.argv.includes("--write");
const FILES = execSync(
  `grep -rl 'fontWeight: 700, fontSize: "var(--cc-t-15)", color: "var(--cc-text)"' 'app' 'components' --include=*.tsx`,
  { encoding: "utf8" },
).trim().split("\n").filter(Boolean);

const TYPE = `fontWeight: 700, fontSize: "var(--cc-t-15)", color: "var(--cc-text)"`;
let total = 0;

for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  let out = "";
  let i = 0;
  let hits = 0;
  for (;;) {
    const at = src.indexOf(`style={{ ${TYPE}`, i);
    if (at < 0) { out += src.slice(i); break; }
    const close = src.indexOf("}}", at);
    if (close < 0) { out += src.slice(i); break; }
    const inner = src.slice(at + "style={{ ".length, close).trim().replace(/,$/, "");
    /* Whatever follows the three type declarations is this call site's own
       layout; an empty remainder means the style was nothing but type and the
       attribute goes away entirely. */
    const rest = inner.slice(TYPE.length).replace(/^\s*,\s*/, "").trim();
    out += src.slice(i, at);
    out += rest ? `className="cc-panel-title" style={{ ${rest} }}` : `className="cc-panel-title"`;
    i = close + 2;
    hits++;
  }
  if (hits) {
    total += hits;
    console.log(`${hits.toString().padStart(3)}  ${f}`);
    if (WRITE) writeFileSync(f, out);
  }
}
console.log(`${total} panel titles in ${FILES.length} files${WRITE ? " -- written" : " (dry run; pass --write)"}`);
