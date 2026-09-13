/**
 * The layout-token contract, enforced.
 *
 * These rules cannot be checked by ESLint -- they are properties of the
 * stylesheet, not of the TypeScript. Each one corresponds to a bug that has
 * already happened in this file at least once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { Root, Rule } from "postcss";

const CSS_PATH = path.join(process.cwd(), "app", "globals.css");
const css = readFileSync(CSS_PATH, "utf8");
const root: Root = postcss.parse(css, { from: CSS_PATH });

const rules: Rule[] = [];
root.walkRules((r) => {
  rules.push(r);
});

const topLevel = (r: Rule) => r.parent?.type === "root";
const isBaseRoot = (r: Rule) => r.selector.trim() === ":root" && topLevel(r);

/** Every custom property declared in the base :root block. */
const baseTokens = new Set<string>();
for (const r of rules.filter(isBaseRoot)) {
  r.walkDecls((d) => {
    if (d.prop.startsWith("--")) baseTokens.add(d.prop);
  });
}

const THEME_SELECTOR = /(^|[\s,])(:root)?\.(dark|creatorcore)\b/;

describe("globals.css layout-token contract", () => {
  it("uses no !important anywhere", () => {
    const offenders: string[] = [];
    root.walkDecls((d) => {
      if (d.important) offenders.push(`${d.parent?.toString().split("{")[0].trim()} { ${d.prop} } (line ${d.source?.start?.line})`);
    });
    // !important is banned on this project. Every one that used to be here
    // existed because an inline style out-specified the stylesheet; the fix is
    // to remove the inline style, never to add a bigger hammer.
    expect(offenders).toEqual([]);
  });

  it("has exactly one top-level bare :root block", () => {
    // A second bare :root carries the same specificity as the first, so which
    // one wins is decided by SOURCE ORDER. That is how a theme's
    // --cc-sidebar-w once lost to a layout block further down the file and the
    // rail silently stayed 264px.
    const bare = rules.filter(isBaseRoot);
    expect(bare.map((r) => r.source?.start?.line)).toHaveLength(1);
  });

  it("declares every referenced --cc-* token in the base :root", () => {
    const referenced = new Set<string>();
    root.walkDecls((d) => {
      for (const m of String(d.value).matchAll(/var\((--[a-zA-Z0-9-]+)/g)) referenced.add(m[1]);
    });
    const missing = [...referenced].filter((t) => t.startsWith("--cc-") && !baseTokens.has(t));
    expect(missing).toEqual([]);
  });

  it("lets a theme re-point tokens but never invent them", () => {
    // Law 1. --cc-r-card used to break this: it existed only inside
    // .creatorcore, so no other theme could reach it and the base had no value.
    const invented: string[] = [];
    for (const r of rules) {
      if (!THEME_SELECTOR.test(r.selector)) continue;
      r.walkDecls((d) => {
        if (d.prop.startsWith("--cc-") && !baseTokens.has(d.prop)) {
          invented.push(`${d.prop} in "${r.selector}" (line ${d.source?.start?.line})`);
        }
      });
    }
    expect(invented).toEqual([]);
  });

  it("keeps .dark colour-only", () => {
    // The control group. A theme that varies only colour should need zero
    // geometry declarations; if this ever fails, the token contract has a hole
    // somewhere else and .dark is the first place it shows.
    const GEOMETRY = /^(display|gap|row-gap|column-gap|padding|margin|align-|justify-|flex|grid|order|position|top|right|bottom|left|inset|width|height|min-|max-|overflow)/;
    const geometry: string[] = [];
    for (const r of rules) {
      if (!/(^|[\s,])(:root)?\.dark\b/.test(r.selector)) continue;
      r.walkDecls((d) => {
        if (!d.prop.startsWith("--") && GEOMETRY.test(d.prop)) {
          geometry.push(`${d.prop} in "${r.selector}" (line ${d.source?.start?.line})`);
        }
      });
    }
    expect(geometry).toEqual([]);
  });

  it("declares theme token blocks as :root.<theme>, not a bare class", () => {
    // Law 2. A bare `.creatorcore { --x }` is (0,1,0) -- the same as :root --
    // so it wins or loses on source order alone. `:root.creatorcore` is
    // (0,2,0) and wins on specificity, which is stable.
    const bareTokenBlocks: string[] = [];
    for (const r of rules) {
      const sel = r.selector.trim();
      if (!/^\.(dark|creatorcore)$/.test(sel)) continue;
      let declaresToken = false;
      r.walkDecls((d) => {
        if (d.prop.startsWith("--")) declaresToken = true;
      });
      if (declaresToken) bareTokenBlocks.push(`${sel} (line ${r.source?.start?.line})`);
    }
    expect(bareTokenBlocks).toEqual([]);
  });
});
