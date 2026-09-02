import fs from "node:fs";
import path from "node:path";

/**
 * Every fetch capability has a caller.
 *
 * This exists because of a specific, embarrassing failure. `openSandboxPostFetcher`
 * was written, reviewed, unit-tested and shipped with ZERO callers: the
 * single-post "Sync Now" route still fetched TikTok through ordinary function
 * egress, hit the WAF, and reported "no metrics found" in 2.5 seconds -- while
 * the bulk refresh measured the very same post through a sandbox. 1650 passing
 * tests, a code review and a written audit all missed it, because every one of
 * them checked that the helper WORKED and none checked that anything used it.
 * It was found by pressing the button in production.
 *
 * A helper nothing calls is not a feature, and the gap is invisible to tests
 * that mock the thing they are verifying. So these assertions read the real
 * source files and require the wiring itself.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("fetch capabilities are wired to a caller", () => {
  const WIRINGS: Array<{ capability: string; caller: string; why: string }> = [
    {
      capability: "openSandboxPostFetcher",
      caller: "app/api/campaigns/[id]/posts/[postId]/sync/route.ts",
      why:
        "TikTok serves function egress a WAF login shell roughly three times in four. " +
        "Without a sandbox, Sync Now on a TikTok post fails while the bulk refresh succeeds.",
    },
    {
      capability: "openSandboxPostPool",
      caller: "lib/sync/refreshCampaign.ts",
      why: "The bulk refresh needs several egress addresses to cover a campaign inside its budget.",
    },
    {
      capability: "fetchInstagramEmbedPost",
      caller: "lib/platforms/fetchPostMetrics.ts",
      why:
        "The only Instagram source left that answers without a credential. It is what fills a " +
        "like count Business Discovery withheld, and what reaches a post older than the media " +
        "pages we can walk.",
    },
  ];

  for (const { capability, caller, why } of WIRINGS) {
    it(`${capability} is called by ${caller}`, () => {
      const src = read(caller);
      expect(src).toContain(`${capability}(`);
      // An import alone is not wiring -- the pre-fix route imported nothing at
      // all, but a later refactor could plausibly leave a dangling import.
      expect(src).toMatch(new RegExp(`import[^;]*${capability}[^;]*;`, "s"));
      expect(why.length).toBeGreaterThan(0);
    });
  }

  /**
   * The generic half: catches the NEXT unwired sandbox helper, not just the one
   * that already bit us. Any `openSandbox*` export is, by construction, a thing
   * whose entire value is being called from a request path.
   */
  it("every exported openSandbox* helper is called from outside its own module", () => {
    const platformsDir = path.join(ROOT, "lib/platforms");
    const sources = fs
      .readdirSync(platformsDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ file: `lib/platforms/${f}`, text: read(`lib/platforms/${f}`) }));

    const exported: Array<{ name: string; file: string }> = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/export\s+function\s+(openSandbox\w+)/g)) {
        exported.push({ name: m[1], file });
      }
    }
    // If this ever drops to zero the assertion below becomes vacuous.
    expect(exported.length).toBeGreaterThan(0);

    const callers = [
      ...walk(path.join(ROOT, "app")),
      ...walk(path.join(ROOT, "lib")),
    ].map((p) => ({ rel: path.relative(ROOT, p), text: fs.readFileSync(p, "utf8") }));

    const unwired = exported.filter(({ name, file }) =>
      !callers.some((c) => c.rel !== file && c.text.includes(`${name}(`)),
    );
    expect(unwired).toEqual([]);
  });
});

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}
