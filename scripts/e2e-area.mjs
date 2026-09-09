#!/usr/bin/env node
/**
 * Run the E2E specs for one part of the app instead of all 37 files.
 *
 *   node scripts/e2e-area.mjs --list                 what areas exist
 *   node scripts/e2e-area.mjs campaigns analytics    run those areas
 *   node scripts/e2e-area.mjs --affected             run what is unreleased (vs origin/master)
 *   node scripts/e2e-area.mjs --affected --since HEAD   run what you just changed
 *   node scripts/e2e-area.mjs --affected --print     just say what it would run
 *
 * The area table lives in e2e/areas.mjs and is shared with the deploy gate, so
 * "what this area covers" has exactly one definition.
 *
 * --affected compares against origin/master (what production is serving) and
 * includes uncommitted and untracked files, because those ship too. It prints
 * ALL when anything cross-cutting or unrecognised changed; see affectedAreas().
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { AREAS, AREA_NAMES, affectedAreas } from "../e2e/areas.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const git = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch {
    return "";
  }
};

/* A spec on disk that no area claims would be skipped by every targeted run and
   only ever covered by the full suite -- silently. Fail loudly instead. */
function assertNoOrphanSpecs() {
  const onDisk = readdirSync("e2e").filter((f) => f.endsWith(".spec.ts"));
  const mapped = new Set(Object.values(AREAS).flatMap((a) => a.specs));
  const orphans = onDisk.filter((f) => !mapped.has(f));
  if (orphans.length) {
    console.error(
      `e2e/areas.mjs does not assign these specs to an area:\n  ${orphans.join("\n  ")}\n` +
        `Add them to an area (or a new one) so targeted runs cover them.`,
    );
    process.exit(2);
  }
}

if (has("--list")) {
  assertNoOrphanSpecs();
  for (const a of AREA_NAMES) {
    console.log(`${a.padEnd(13)} ${String(AREAS[a].specs.length).padStart(2)} specs   ${AREAS[a].specs.join(", ")}`);
  }
  process.exit(0);
}

let areas;
if (has("--affected")) {
  /* Two different questions share this flag.
     "What must pass before I deploy?" is measured against origin/master -- what
     production is serving -- so everything unreleased counts.
     "What did I just touch?" is measured against HEAD, and is the one you want
     while iterating. Deploy safety uses the first; --since lets you ask the
     second without pretending the rest of the branch is verified. */
  const sinceIdx = argv.indexOf("--since");
  const explicit = sinceIdx >= 0 ? argv[sinceIdx + 1] : null;
  const base = explicit
    ? explicit
    : git(["rev-parse", "--verify", "--quiet", "origin/master"]).trim()
      ? "origin/master"
      : "HEAD";
  if (explicit && !git(["rev-parse", "--verify", "--quiet", explicit]).trim()) {
    console.error(`--since: no such git ref: ${explicit}`);
    process.exit(2);
  }
  const changed = [
    ...git(["diff", "--name-only", base]).split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ].filter(Boolean);

  const r = affectedAreas(changed);
  if (r.full) {
    if (has("--print")) {
      console.log("ALL");
      console.error(`# ${r.reason}`);
      process.exit(0);
    }
    console.error(`Running the FULL suite -- ${r.reason}`);
    process.exit(spawnSync("npx", ["playwright", "test"], { stdio: "inherit" }).status ?? 1);
  }
  areas = r.areas;
  if (has("--print")) {
    console.log(areas.length ? areas.join(" ") : "NONE");
    if (r.reason) console.error(`# ${r.reason}`);
    process.exit(0);
  }
  if (!areas.length) {
    console.log("No app code changed against origin/master -- nothing to run.");
    process.exit(0);
  }
  console.error(`Affected areas: ${areas.join(", ")}`);
} else {
  const sinceIdx = argv.indexOf("--since");
  areas = argv.filter((a, i) => !a.startsWith("-") && !(sinceIdx >= 0 && i === sinceIdx + 1));
  if (!areas.length) {
    console.error(`usage: node scripts/e2e-area.mjs <area>... | --affected | --list\nareas: ${AREA_NAMES.join(", ")}`);
    process.exit(2);
  }
  const bad = areas.filter((a) => !AREA_NAMES.includes(a));
  if (bad.length) {
    console.error(`unknown area(s): ${bad.join(", ")}\nareas: ${AREA_NAMES.join(", ")}`);
    process.exit(2);
  }
}

assertNoOrphanSpecs();

const specs = [...new Set(areas.flatMap((a) => AREAS[a].specs))].map((s) => `e2e/${s}`);
const missing = specs.filter((s) => !existsSync(s));
if (missing.length) {
  console.error(`area map points at specs that do not exist:\n  ${missing.join("\n  ")}`);
  process.exit(2);
}

console.error(`Running ${specs.length} spec file(s) for: ${areas.join(", ")}`);
process.exit(spawnSync("npx", ["playwright", "test", ...specs], { stdio: "inherit" }).status ?? 1);
