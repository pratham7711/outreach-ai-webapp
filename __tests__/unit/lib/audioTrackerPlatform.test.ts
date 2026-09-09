import fs from "node:fs";
import path from "node:path";

/**
 * An audio tracker is only ever read by a reader for its own platform.
 *
 * TikTokSound.platform admits INSTAGRAM as well as TIKTOK -- the create route
 * parses it off the pasted URL and stores it, and refuses to merge the two
 * because "the same numeric id can exist on both". Every audio reader in the
 * repo, though, builds a TikTok sound URL out of `tiktokSoundId`. So an
 * unfiltered sweep does something worse than fail: it reads TIKTOK's usage
 * curve and stores it against an Instagram tracker, and the numbers look
 * completely plausible.
 *
 * Asserted against the source rather than through the query, because the defect
 * IS the absence of a clause -- a behavioural test would need an Instagram
 * fixture that the sweep is supposed to never touch, and would pass just as
 * happily if the sweep stopped touching everything. Measured on prod
 * 2026-09-09: 1 audio tracker, platform TIKTOK, so this guards a reachable
 * state rather than repairing a live one.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SWEEPS = [
  {
    file: "lib/sounds/snapshot.ts",
    what: "the nightly snapshot-sounds sweep",
  },
  {
    file: "app/api/cron/sync-trackers/route.ts",
    what: "the hourly sync-trackers sweep",
  },
];

describe("audio sweeps read TikTok sounds only", () => {
  for (const { file, what } of SWEEPS) {
    it(`${what} constrains platform on its tikTokSound query`, () => {
      /* Comments stripped first: the clause is explained at length in both
         sweeps, and a prose window would otherwise decide whether the code
         passes. */
      const src = read(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const opens = [...src.matchAll(/db\.tikTokSound\.findMany\(/g)];
      expect(opens.length).toBeGreaterThan(0);

      for (const open of opens) {
        const window = src.slice(open.index!, open.index! + 600);
        /* A query already narrowed to specific ids inherits the constraint from
           whichever query produced those ids, so requiring the clause twice
           would only invite someone to satisfy it by rote. It is the query that
           chooses rows from the whole table that has to say which platform it
           means. */
        if (/id:\s*\{\s*in:/.test(window)) continue;
        expect(window).toMatch(/platform:\s*"TIKTOK"/);
      }
    });
  }

  it("no audio reader exists for Instagram yet, so skipping is the honest behaviour", () => {
    /* If someone adds one, this fails and the filters above become wrong rather
       than merely conservative -- which is the moment to widen them, not
       before. */
    const platforms = path.join(ROOT, "lib/platforms");
    const instagramAudioReaders = fs
      .readdirSync(platforms)
      .filter((f) => /instagram/i.test(f) && /(sound|audio)/i.test(f));
    expect(instagramAudioReaders).toEqual([]);
  });
});
