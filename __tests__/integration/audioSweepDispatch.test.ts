/**
 * @jest-environment node
 *
 * The behavioural half of the platform guard: each audio reader is handed only
 * its own platform's ids, and an Instagram row produces an Instagram-shaped
 * snapshot.
 *
 * This test was not possible before. While Instagram had no reader, the sweep's
 * correct behaviour was to touch nothing, and a test asserting that would pass
 * just as happily if the sweep stopped touching everything -- which is why the
 * guard was a source grep. Now both readers exist, so "the TikTok reader was
 * asked for the TikTok id and nothing else" is a real, falsifiable claim.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/tiktokAudioUsage", () => ({
  readTikTokAudioUsage: jest.fn(),
  isMeasuredRung: (rung: string) => rung === "embed-direct" || rung === "embed-sandbox",
}));
jest.mock("@/lib/platforms/instagramAudioUsage", () => ({
  readInstagramAudioUsage: jest.fn(),
}));

import { db } from "@/lib/db";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { readTikTokAudioUsage } from "@/lib/platforms/tiktokAudioUsage";
import { readInstagramAudioUsage } from "@/lib/platforms/instagramAudioUsage";

const mockDb = db as unknown as {
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};
const tiktokReader = readTikTokAudioUsage as jest.Mock;
const instagramReader = readInstagramAudioUsage as jest.Mock;

/* Deliberately the SAME numeric id on both platforms. That collision is the
   whole reason the dispatch exists: it is legal, it is what the create route
   refuses to merge, and a sweep that keys readings by id alone would answer one
   row with the other's number. */
const SHARED_ID = "7678797827745155089";

const row = (over: Record<string, unknown>) => ({
  id: "row",
  platform: "TIKTOK",
  tiktokSoundId: SHARED_ID,
  title: null,
  artist: null,
  coverImageUrl: null,
  snapshots: [],
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
  mockDb.tikTokSound.update.mockResolvedValue({});
  tiktokReader.mockResolvedValue(new Map());
  instagramReader.mockResolvedValue(new Map());
});

const written = () => mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;

it("asks each reader for its own platform's ids and no others", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "tt", platform: "TIKTOK", tiktokSoundId: SHARED_ID }),
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "2094289147512017" }),
  ]);

  await snapshotSounds();

  expect(tiktokReader).toHaveBeenCalledWith([SHARED_ID], expect.anything());
  expect(instagramReader).toHaveBeenCalledWith(["2094289147512017"], expect.anything());
});

it("does not read an Instagram row through the TikTok ladder", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: SHARED_ID }),
  ]);
  /* The TikTok reader would answer for this id, because the id exists on
     TikTok too. Nothing may ask it. */
  tiktokReader.mockResolvedValue(
    new Map([[SHARED_ID, { ok: true, rung: "embed-direct", stats: { usesCount: 999_999 } }]]),
  );

  await snapshotSounds();

  expect(tiktokReader).not.toHaveBeenCalled();
  expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
});

it("records an Instagram reading, keeping the level and the names", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "2094289147512017" }),
  ]);
  instagramReader.mockResolvedValue(
    new Map([
      [
        "2094289147512017",
        {
          ok: true,
          reading: {
            usesCount: 9482,
            precision: "exact",
            title: "Runaway",
            artist: "AURORA",
            coverImageUrl: "https://scontent.cdninstagram.com/cover.jpg",
          },
        },
      ],
    ]),
  );

  const result = await snapshotSounds();

  expect(result.snapshots).toBe(1);
  expect(written().usesCount).toBe(9482);
  expect(mockDb.tikTokSound.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ title: "Runaway", artist: "AURORA" }) }),
  );
});

/* The reason the reading carries a precision at all. Instagram prints "1M
   reels" for anything large, so yesterday's rounded level and today's rounded
   level can differ by the whole rounding step while nothing happened -- and the
   column this lands in is rendered as "Videos Added (Since Last Sync)" on a
   client-facing report. */
it("withholds the delta between two rounded levels rather than inventing one", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "ig-1", snapshots: [{ usesCount: 900_000 }] }),
  ]);
  instagramReader.mockResolvedValue(
    new Map([
      ["ig-1", { ok: true, reading: { usesCount: 1_000_000, precision: "rounded", title: null, artist: null, coverImageUrl: null } }],
    ]),
  );

  await snapshotSounds();

  // The level is worth keeping; the 100,000 is an artefact of the rounding.
  expect(written().usesCount).toBe(1_000_000);
  expect(written().videosAdded24h).toBe(0);
  expect(written().deltaUses24h).toBe(0);
  expect(written().velocityScore).toBe(0);
});

it("still diffs two exact Instagram readings", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "ig-1", snapshots: [{ usesCount: 400 }] }),
  ]);
  instagramReader.mockResolvedValue(
    new Map([
      ["ig-1", { ok: true, reading: { usesCount: 460, precision: "exact", title: null, artist: null, coverImageUrl: null } }],
    ]),
  );

  await snapshotSounds();

  expect(written().videosAdded24h).toBe(60);
  expect(written().deltaUses24h).toBe(60);
});

/* An audio page that publishes no count is working exactly as Instagram
   allows. Counting it as a failure would put a permanent entry in the nightly
   alert ratio for a tracker that is not broken. */
it("skips an audio that publishes no count instead of failing it", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "ig-1" }),
  ]);
  instagramReader.mockResolvedValue(new Map([["ig-1", { ok: false, reason: "no-count" }]]));

  const result = await snapshotSounds();

  expect(result.skipped).toBe(1);
  expect(result.failed).toBe(0);
  expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
});

it("counts an audio that does not exist as a failure, not a skip", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "ig-1" }),
  ]);
  instagramReader.mockResolvedValue(new Map([["ig-1", { ok: false, reason: "not-found" }]]));

  const result = await snapshotSounds();

  expect(result.failed).toBe(1);
  expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
});

/* Running out of time is not a failed read, on either platform. */
it("treats an Instagram deadline the way it treats a TikTok one", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue([
    row({ id: "ig", platform: "INSTAGRAM", tiktokSoundId: "ig-1" }),
  ]);
  instagramReader.mockResolvedValue(new Map([["ig-1", { ok: false, reason: "deadline" }]]));

  const result = await snapshotSounds();

  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(0);
});
