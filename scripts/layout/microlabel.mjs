/**
 * Hoists the micro-label inline style onto a class the theme can reach.
 *
 *   node scripts/layout/microlabel.mjs [--write]
 *
 * The column header of a table, the caption over a figure, the name of a group
 * of switches: the same idea, written inline 49 times across the dashboard and
 * drifted into six spellings -- 11px or 12px, weight 500, 700 or
 * var(--cc-fw-strong), letter-spacing 0.04em, 0.05em, 0.06em, 0.3px or 0.5px,
 * coloured --cc-text-subtle or --cc-text-muted. Every one of them uppercase.
 *
 * MEASURED 2026-09-14 at desktop-1600, the reference renders the same role in
 * normal case at weight 400: `Status` on Payouts is 16px/400, `Role` on
 * Settings -> Team 12px/400, the Financials tile captions 15px/400. Ours were
 * 11px/700 uppercase on all three. An inline style is the one thing a theme
 * cannot outrank, so none of them could be re-pointed.
 *
 * Only the five type declarations move -- fontSize, fontWeight, textTransform,
 * letterSpacing and color. Whatever else the style carries (display, padding,
 * a margin, textAlign) is layout that differs per call site and stays. The
 * class owns the type through --cc-microlabel-*, whose base values restate the
 * commonest of the six spellings, so light and dark keep this label looking
 * like the label they had.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const WRITE = process.argv.includes("--write");
const TYPE_KEYS = new Set(["fontSize", "fontWeight", "textTransform", "letterSpacing", "color"]);

const FILES = execSync(
  `grep -rl 'textTransform: "uppercase"' 'app/(dashboard)' 'components' --include=*.tsx`,
  { encoding: "utf8" },
).trim().split("\n").filter(Boolean);

/** Splits a flat style-object body on top-level commas. */
function splitProps(inner) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) { if (c === quote && inner[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(inner.slice(start, i)); start = i + 1; }
  }
  out.push(inner.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

let total = 0;
for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  let out = "", i = 0, hits = 0;
  for (;;) {
    const at = src.indexOf("style={{", i);
    if (at < 0) { out += src.slice(i); break; }
    /* Only flat object literals: a style whose body contains a nested brace is
       a spread or a conditional and is left alone. */
    const close = src.indexOf("}}", at);
    if (close < 0) { out += src.slice(i); break; }
    const inner = src.slice(at + "style={{".length, close);
    const props = splitProps(inner);
    const type = props.filter((p) => TYPE_KEYS.has(p.slice(0, p.indexOf(":")).trim()));
    const hasUpper = props.some((p) => /^textTransform:\s*"uppercase"$/.test(p));
    const small = props.some((p) => /^fontSize:\s*("var\(--cc-t-1[012]\)"|1[012](\.5)?)$/.test(p));
    const weighted = props.some((p) => p.startsWith("fontWeight:"));
    if (!hasUpper || !small || !weighted || inner.includes("{")) {
      out += src.slice(i, close + 2);
      i = close + 2;
      continue;
    }
    /* The class goes on the same tag. If the tag already names one, append. */
    const tagAt = src.lastIndexOf("<", at);
    const tag = src.slice(tagAt, at);
    const rest = props.filter((p) => !type.includes(p));
    const styleAttr = rest.length ? ` style={{ ${rest.join(", ")} }}` : "";
    let head = src.slice(i, at);
    const cn = /className="([^"]*)"/.exec(tag);
    if (cn) {
      const abs = tagAt + cn.index;
      head = src.slice(i, abs) + `className="${cn[1]} cc-microlabel"` + src.slice(abs + cn[0].length, at);
      out += head + styleAttr.replace(/^ /, "");
      if (!rest.length) out = out.replace(/\s*$/, "");
    } else {
      out += head + `className="cc-microlabel"` + styleAttr;
    }
    i = close + 2;
    hits++;
  }
  if (hits) {
    total += hits;
    console.log(`${String(hits).padStart(3)}  ${f}`);
    if (WRITE) writeFileSync(f, out);
  }
}
console.log(`${total} micro-labels in ${FILES.length} files${WRITE ? " -- written" : " (dry run; pass --write)"}`);
