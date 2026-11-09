/**
 * No rule may style something BELOW a :has() -- `X:has(...) > *`,
 * `X:has(...) .y`, and every Tailwind "group-has" / "peer-has" variant, which
 * compile to `:is(:where(.group):has(...) *)` and `... ~ *`.
 *
 * One such rule, alongside any :has() whose argument can match deep in the
 * tree (`:has([aria-expanded="true"])`, which shadcn's table row carries), and
 * Chrome restyles the whole document on every DOM insertion anywhere. Measured
 * on a 300-row list (9,318 elements): an appended span forced a 15ms style
 * recalc (20ms in the since-removed CreatorCore theme) with the five such
 * rules present and 0.2ms without them, in every theme; each rule alone
 * measured 0.2ms, so no one of them looks guilty in isolation. At 4x CPU
 * that was 60-80ms per avatar that failed over to initials, five times per
 * page load.
 *
 * A :has() on the subject itself (`X:has(> .y) { ... }`) is fine and stays.
 *
 * Tailwind emits a class from ANY file it scans -- a comment in a test is
 * enough -- so the variant check covers every file git does not ignore.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const VARIANT = new RegExp(["\\b(?:group|peer)", "has", "[^\\s\"'`]*"].join("-"), "g");
const TEXT = /\.(tsx?|jsx?|mjs|cjs|mdx?|html|css|json)$/;
const BELOW_HAS = /:has\((?:[^()]|\([^()]*\))*\)\s*(?:[>~+]\s*|\s+)[*.\w#[:]/;

describe("rules styled below a :has()", () => {
  it("has no group/peer has variant in any file Tailwind scans", () => {
    const files = execSync("git ls-files -co --exclude-standard", { encoding: "utf8" })
      .split("\n")
      .filter((f) => TEXT.test(f));
    const found: string[] = [];
    for (const f of files) {
      let text: string;
      try {
        text = readFileSync(f, "utf8");
      } catch {
        continue;
      }
      for (const m of text.match(VARIANT) ?? []) found.push(`  ${f}: ${m}`);
    }
    expect(found.join("\n") || "none").toBe("none");
  });

  it("has no globals.css selector whose subject sits under a :has()", () => {
    const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const found = [...css.matchAll(/([^{}]+)\{/g)]
      .flatMap((m) => m[1].split(","))
      .map((sel) => sel.trim())
      .filter((sel) => BELOW_HAS.test(sel));
    expect(found.join("\n") || "none").toBe("none");
  });
});
