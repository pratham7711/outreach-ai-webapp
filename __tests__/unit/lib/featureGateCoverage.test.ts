import fs from "fs";
import path from "path";
import * as featureKeys from "@/lib/featureKeys";
import { PLANS, type PlanName } from "@/lib/plans";

/**
 * A route that gates on a feature key no tier grants is a 403 for every org on
 * every plan, and nothing anywhere says so: the request looks entitled, the
 * gate says no, and the screen renders as if the org simply has no data.
 *
 * That is exactly what `creator_discovery` and `ai_assistant` were. Both were
 * gated -- /api/discovery, /api/ai/briefing, /api/ai/nl-query,
 * /api/campaigns/[id]/outreach/draft -- and neither appeared in lib/plans.ts.
 * The suite stayed green because prisma/seed.ts writes them straight into
 * OrgPlanConfig.features, so every test org had them and no test org got them
 * from a plan.
 *
 * So this reads the gates out of the source rather than restating them: add a
 * hasOrgFeature() call with a new key and this test fails until a tier grants
 * it.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "lib", "components"];

function sourceFiles(dir: string): string[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(next));
    else if (/\.tsx?$/.test(entry.name)) out.push(next);
  }
  return out;
}

/** Every string a featureKeys export resolves to — the consts are strings, the
 *  REPORTS_FEATURE_KEYS-style exports are readonly arrays of them. */
function keysFor(identifier: string): string[] {
  const value = (featureKeys as Record<string, unknown>)[identifier];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/* The argument list up to its closing paren. No gate call nests parentheses --
   they are all `hasOrgFeature(entitlements, X)` or the `[...KEYS]` spread -- so
   stopping at the first `)` is enough, and the uppercase-identifier scan below
   ignores the `entitlements` argument on its own. */
const GATE_CALL = /has(?:Any)?OrgFeature\(([^)]*)\)/g;

/** One entry per gate, because hasAnyOrgFeature() passes on any one of its
 *  keys — /api/reports gates on [reports, basic_reports, advanced_reports] and
 *  only needs one of the three to be sold. A single-key gate is the same rule
 *  with a group of one. */
function gates(): { label: string; keys: string[] }[] {
  const found: { label: string; keys: string[] }[] = [];
  for (const dir of SCAN_DIRS) {
    for (const rel of sourceFiles(dir)) {
      if (rel === path.join("lib", "entitlements.ts")) continue;
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      for (const match of src.matchAll(GATE_CALL)) {
        const keys = (match[1].match(/[A-Z][A-Z0-9_]*/g) ?? []).flatMap(keysFor);
        if (keys.length === 0) continue;
        found.push({ label: `${rel} → ${[...new Set(keys)].join(" | ")}`, keys });
      }
    }
  }
  return found;
}

describe("every gated feature key is granted by some plan tier", () => {
  const found = gates();
  const granted = new Set(
    (Object.keys(PLANS) as PlanName[]).flatMap((p) => [...PLANS[p].features] as string[])
  );

  it("finds the gates at all — a regex that matches nothing would pass vacuously", () => {
    expect(found.length).toBeGreaterThanOrEqual(8);
    const allKeys = new Set(found.flatMap((g) => g.keys));
    expect([...allKeys]).toEqual(expect.arrayContaining(["creator_discovery", "ai_assistant"]));
  });

  it.each(found.map((g) => [g.label, g.keys] as const))("%s is sold by some tier", (_label, keys) => {
    expect(keys.filter((k) => granted.has(k))).not.toHaveLength(0);
  });
});
