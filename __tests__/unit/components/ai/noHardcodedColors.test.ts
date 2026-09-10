/**
 * One colour guard for the whole components/ai surface.
 *
 * This replaces seventeen per-file copies of the same assertion, each of which
 * read only its own source file. That shape fails in the direction that matters:
 * a component with no test file of its own was simply never checked, and four of
 * the eighteen components here were in exactly that position. Walking the
 * directory means the rule covers whatever is present, including files added
 * after this was written.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const AI_COMPONENTS = join(__dirname, "../../../../components/ai");
const files = readdirSync(AI_COMPONENTS)
  .filter((f) => f.endsWith(".tsx"))
  .sort();

describe("components/ai colour discipline", () => {
  // Without this, a directory rename turns the guard below into a test that
  // passes over an empty list -- green, and checking nothing.
  it("has component files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("hardcodes no hex colors; every colour comes from a --cc-* token", () => {
    const offenders = files
      .map((f) => ({ f, hits: readFileSync(join(AI_COMPONENTS, f), "utf8").match(/#[0-9a-fA-F]{3,6}/g) }))
      .filter(({ hits }) => hits !== null)
      .map(({ f, hits }) => `${f}: ${hits!.join(", ")}`);

    expect(offenders).toEqual([]);
  });
});
