import fs from "node:fs";
import path from "node:path";

/**
 * An audio tracker is only ever read by a reader for its own platform.
 *
 * The hazard has not changed since this file was written; only the defence
 * has. `TikTokSound.platform` admits INSTAGRAM as well as TIKTOK, the same
 * numeric id can exist on both, and every TikTok reader builds a TikTok sound
 * URL out of `tiktokSoundId`. An Instagram row reaching a TikTok reader does
 * something worse than fail: it stores TikTok's usage curve against an
 * Instagram tracker, and the numbers look completely plausible.
 *
 * What changed is that an Instagram reader now exists
 * (lib/platforms/instagramAudioUsage), so the sweeps no longer protect
 * themselves with `where: { platform: "TIKTOK" }` -- they read both platforms
 * and dispatch. This file's previous last test said exactly what to do at this
 * point: "If someone adds one, this fails and the filters above become wrong
 * rather than merely conservative -- which is the moment to widen them, not
 * before." That moment arrived, so the guard moved from "the query is filtered"
 * to "the ids are partitioned before they reach a reader".
 *
 * Asserted against the source because the defect is still the ABSENCE of a
 * clause. The behavioural half of this -- that each reader receives only its
 * own platform's ids -- is in __tests__/integration/audioSweepDispatch.test.ts,
 * which is only possible now that both readers exist.
 */
const ROOT = path.resolve(__dirname, "../../..");

/* Comments stripped first: both sweeps explain this at length, and a prose
   window would otherwise decide whether the code passes. */
const read = (p: string) =>
  fs
    .readFileSync(path.join(ROOT, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SWEEPS = [
  { file: "lib/sounds/snapshot.ts", what: "the nightly snapshot-sounds sweep" },
  { file: "app/api/cron/sync-trackers/route.ts", what: "the hourly sync-trackers sweep" },
];

describe("audio sweeps route each row to its own platform's reader", () => {
  for (const { file, what } of SWEEPS) {
    const src = read(file);

    it(`${what} hands the TikTok reader a TikTok-only list`, () => {
      const calls = [...src.matchAll(/readTikTokAudioUsage\(\s*([A-Za-z0-9_]+)/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        /* The argument must name a collection that was narrowed to TikTok.
           Passing `due` -- every row, both platforms -- is the regression, and
           it is the one that silently stores the wrong platform's curve. */
        expect(call[1]).toMatch(/TikTok$/);
      }
    });

    it(`${what} narrows that list by platform rather than by luck`, () => {
      expect(src).toMatch(/filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.platform === "TIKTOK"\s*\)/);
      expect(src).toMatch(/filter\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.platform === "INSTAGRAM"\s*\)/);
    });

    it(`${what} actually reads Instagram rather than dropping them`, () => {
      /* The old filters were honest while nothing could read Instagram. Now
         that something can, silently excluding those rows would be a tracker
         that never reads -- which is the state the whole feature exists to
         prevent. */
      expect(src).toMatch(/readInstagramAudioUsage\(/);
    });

    it(`${what} selects platform, or the dispatch above has nothing to read`, () => {
      expect(src).toMatch(/platform:\s*true/);
    });
  }

  it("keeps the Instagram reader out of the TikTok ladder's files", () => {
    /* The two platforms are read from completely different places and the
       reasons they fail are different types. Merging them into the TikTok
       ladder would put Instagram's "this page publishes no count" into a union
       whose callers treat every non-ok as a failed fetch. */
    const tiktokLadder = read("lib/platforms/tiktokAudioUsage.ts");
    expect(tiktokLadder).not.toMatch(/instagram/i);
  });
});
