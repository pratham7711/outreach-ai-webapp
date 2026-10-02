/**
 * One source of colour (plan §04): components read theme tokens, never a
 * literal. The literals that exist are recorded per file as debt in
 * hardcoded-colours-baseline.json; a file may not gain one, a new file starts
 * at zero, and a file that has lost some must have its line lowered so the
 * debt only shrinks. COLOUR_BASELINE=write rewrites the file after a cleanup.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOTS = ["app", "components"];
const BASELINE_FILE = path.join(__dirname, "hardcoded-colours-baseline.json");

/* Surfaces that cannot read a CSS variable, so a literal is the only way to
   colour them: Satori renders the OG images without a stylesheet, and
   global-error replaces the root layout, globals.css included. */
const EXEMPT = [/\/opengraph-image\.tsx$/, /\/twitter-image\.tsx$/, /^app\/global-error\.tsx$/];

const LITERAL = /(?<![\w&/])(?<!href=\{?["'`])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\(/g;

function walk(dir: string, out: string[]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
}

function countLiterals(): Record<string, number> {
  const files: string[] = [];
  for (const r of ROOTS) walk(path.join(process.cwd(), r), files);
  const counts: Record<string, number> = {};
  for (const abs of files) {
    const rel = path.relative(process.cwd(), abs).split(path.sep).join("/");
    if (EXEMPT.some((re) => re.test(rel))) continue;
    const n = (readFileSync(abs, "utf8").match(LITERAL) ?? []).length;
    if (n > 0) counts[rel] = n;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe("hard-coded colours", () => {
  const now = countLiterals();

  if (process.env.COLOUR_BASELINE === "write") {
    it("writes the baseline", () => {
      writeFileSync(BASELINE_FILE, JSON.stringify(now, null, 2) + "\n");
    });
    return;
  }

  const recorded: Record<string, number> = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));

  it("finds no new colour literal in app/ or components/", () => {
    const grew = Object.entries(now)
      .filter(([f, n]) => n > (recorded[f] ?? 0))
      .map(([f, n]) => `  ${f}: ${recorded[f] ?? 0} -> ${n}`);
    expect(grew.join("\n") || "none").toBe("none");
  });

  it("lowers the baseline when literals are removed, so the debt only shrinks", () => {
    const shrank = Object.entries(recorded)
      .filter(([f, n]) => (now[f] ?? 0) < n)
      .map(([f, n]) => `  ${f}: ${n} -> ${now[f] ?? 0}`);
    expect(shrank.join("\n") || "none").toBe("none");
  });

  it("matches the matcher against the shapes it has to catch, and not anchors or entities", () => {
    const hits = (s: string) => (s.match(LITERAL) ?? []).length;
    expect(hits(`color: "#fff"`)).toBe(1);
    expect(hits(`background: "#5B5BD6"`)).toBe(1);
    expect(hits(`border: "1px solid #E4E6F0CC"`)).toBe(1);
    expect(hits(`boxShadow: "0 1px 2px rgba(0,0,0,0.1)"`)).toBe(1);
    expect(hits(`color: "var(--cc-text, #1C2048)"`)).toBe(1);
    expect(hits(`href="#add"`)).toBe(0);
    expect(hits(`"&#039;"`)).toBe(0);
    expect(hits(`"/campaigns#face"`)).toBe(0);
    expect(hits(`color: "var(--cc-text)"`)).toBe(0);
  });
});
