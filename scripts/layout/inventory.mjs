/**
 * The census. Emits docs/layout-inventory.json -- the human-reviewable artifact
 * for the whole conversion.
 *
 *   node scripts/layout/inventory.mjs [--json <path>] [--top <n>]
 *
 * A reviewer reads ~1,800 lines of `signature -> proposed class` once, instead
 * of 5,000 lines of machine-generated JSX. That is the entire point: the review
 * object is this file, not the diff.
 *
 * Uses the TypeScript compiler API directly rather than ts-morph, because
 * `typescript` is already a direct dependency and `npm install` in this repo is
 * known to drop 417 lines from package-lock.json under Node 26 / npm 11. The
 * codemod itself will need ts-morph for trivia-preserving writes; the census
 * does not write anything, so it stays install-free.
 */
import ts from "typescript";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import path from "node:path";
import { classify, DIMENSION_PROPS } from "./properties.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCAN_DIRS = ["app", "components"];
const SKIP = [/node_modules/, /\.next/, /components[\\/]ui[\\/]/, /global-error\.tsx$/];

const args = process.argv.slice(2);
const outPath = args.includes("--json")
  ? args[args.indexOf("--json") + 1]
  : path.join(ROOT, "docs", "layout-inventory.json");
const topN = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 40;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP.some((re) => re.test(full))) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.tsx$/.test(name)) acc.push(full);
  }
  return acc;
}

/**
 * A signature is the sorted property names of one style object. Values are
 * deliberately dropped: `gap: 8` and `gap: 12` are the same SHAPE and map to
 * the same class with a different data-gap, so grouping by shape is what makes
 * the top-50 cover ~900 sites.
 */
function signatureOf(props) {
  return props.map((p) => p.name).sort().join(",");
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const sites = [];
const styleElements = [];

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(ROOT, file);

  const visit = (node) => {
    // <style> elements: a second, invisible theming blocker. A theme cannot
    // reach a stylesheet a component prints at runtime.
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === "style"
    ) {
      styleElements.push({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }

    // style={{ ... }}
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isObjectLiteralExpression(node.initializer.expression)
    ) {
      const obj = node.initializer.expression;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const props = [];
      let hasSpread = false;

      for (const p of obj.properties) {
        if (ts.isSpreadAssignment(p)) { hasSpread = true; continue; }
        if (!ts.isPropertyAssignment(p) && !ts.isShorthandPropertyAssignment(p)) continue;
        const rawName = p.name.getText(sf).replace(/^["']|["']$/g, "");
        const valueNode = ts.isPropertyAssignment(p) ? p.initializer : null;
        const valueText = valueNode ? valueNode.getText(sf) : "";
        const isLiteral =
          !!valueNode &&
          (ts.isNumericLiteral(valueNode) ||
            ts.isStringLiteral(valueNode) ||
            (ts.isNoSubstitutionTemplateLiteral?.(valueNode) ?? false));
        const isConditional =
          !!valueNode &&
          (ts.isConditionalExpression(valueNode) ||
            ts.isBinaryExpression(valueNode) ||
            ts.isTemplateExpression(valueNode));
        props.push({
          name: rawName,
          kind: rawName.startsWith("--") ? "customProperty" : classify(rawName),
          value: valueText.length > 60 ? valueText.slice(0, 60) + "…" : valueText,
          isLiteral,
          isConditional,
        });
      }

      if (!props.length && !hasSpread) return ts.forEachChild(node, visit);

      const kinds = new Set(props.map((p) => p.kind));
      const layoutProps = props.filter((p) => p.kind === "layout");
      // A computed dimension is legitimate and stays inline, so a site whose
      // only layout properties are computed dimensions is NOT a conversion
      // target -- counting it as one inflates the number and then the codemod
      // has nothing to do with it.
      const convertibleLayout = layoutProps.filter(
        (p) => !(DIMENSION_PROPS.has(p.name) && !p.isLiteral)
      );

      sites.push({
        file: rel,
        line,
        signature: signatureOf(props),
        props,
        hasSpread,
        hasConditional: props.some((p) => p.isConditional),
        layoutCount: layoutProps.length,
        convertibleLayoutCount: convertibleLayout.length,
        pure:
          kinds.size === 1 && kinds.has("layout")
            ? "layout"
            : kinds.size === 1 && (kinds.has("type") || kinds.has("paint"))
            ? "typePaint"
            : "mixed",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---- aggregate --------------------------------------------------------
const withLayout = sites.filter((s) => s.layoutCount > 0);
const convertible = sites.filter((s) => s.convertibleLayoutCount > 0);
const pureLayout = convertible.filter((s) => s.pure === "layout");
const mixed = convertible.filter((s) => s.pure === "mixed");
const conditional = convertible.filter((s) => s.hasConditional);
const spread = convertible.filter((s) => s.hasSpread);

const bySignature = new Map();
for (const s of sites) {
  if (!bySignature.has(s.signature)) bySignature.set(s.signature, { signature: s.signature, count: 0, files: new Set(), example: s });
  const e = bySignature.get(s.signature);
  e.count++;
  e.files.add(s.file);
}
const signatures = [...bySignature.values()]
  .map((e) => ({
    signature: e.signature,
    count: e.count,
    fileCount: e.files.size,
    pure: e.example.pure,
    example: `${e.example.file}:${e.example.line}`,
  }))
  .sort((a, b) => b.count - a.count);

// Value distributions ARE the token scale -- the ramp is derived, not invented.
const valueHistogram = {};
for (const s of sites) {
  for (const p of s.props) {
    if (!p.isLiteral) continue;
    (valueHistogram[p.name] ||= {});
    valueHistogram[p.name][p.value] = (valueHistogram[p.name][p.value] || 0) + 1;
  }
}
const topValues = {};
for (const [prop, hist] of Object.entries(valueHistogram)) {
  topValues[prop] = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

const propFrequency = {};
for (const s of sites) for (const p of s.props) propFrequency[p.name] = (propFrequency[p.name] || 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  scanned: { files: files.length, dirs: SCAN_DIRS, skipped: SKIP.map(String) },
  totals: {
    styleSites: sites.length,
    sitesWithLayoutProp: withLayout.length,
    convertibleSites: convertible.length,
    pureLayout: pureLayout.length,
    mixed: mixed.length,
    withConditional: conditional.length,
    withSpread: spread.length,
    distinctSignatures: signatures.length,
    styleElements: styleElements.length,
  },
  coverage: {
    top50SignatureSites: signatures.slice(0, 50).reduce((n, s) => n + s.count, 0),
  },
  propFrequency: Object.entries(propFrequency).sort((a, b) => b[1] - a[1]),
  topValues,
  signatures,
  styleElements,
  sites,
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));

// ---- console summary --------------------------------------------------
const t = report.totals;
console.log(`files scanned              ${report.scanned.files}`);
console.log(`style={{ }} sites          ${t.styleSites}`);
console.log(`  with a layout property   ${t.sitesWithLayoutProp}`);
console.log(`  CONVERTIBLE              ${t.convertibleSites}   (excludes computed-dimension-only sites)`);
console.log(`    100% layout            ${t.pureLayout}`);
console.log(`    mixed layout+type      ${t.mixed}`);
console.log(`    with a conditional     ${t.withConditional}`);
console.log(`    with a spread          ${t.withSpread}`);
console.log(`distinct signatures        ${t.distinctSignatures}`);
console.log(`top-50 signatures cover    ${report.coverage.top50SignatureSites} sites`);
console.log(`<style> elements           ${t.styleElements}  in ${new Set(styleElements.map((s) => s.file)).size} files`);
console.log(`\ntop ${topN} signatures:`);
for (const s of signatures.slice(0, topN)) {
  console.log(`  ${String(s.count).padStart(4)}  ${s.pure.padEnd(9)} ${s.signature.slice(0, 96)}`);
}
console.log(`\nwritten: ${path.relative(ROOT, outPath)}`);
