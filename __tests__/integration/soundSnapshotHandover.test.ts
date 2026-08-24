/**
 * @jest-environment node
 *
 * This job cannot read a TikTok music page and never could: the count comes from
 * an endpoint that only answers requests carrying headers TikTok's own client
 * script generates. So every sound it tries is a failure, and the alert built on
 * that ratio fires every night.
 *
 * Once the browser worker on the VPS is reading them, that alert is about a job
 * that has been superseded -- and an alert nobody can act on is how the real one
 * gets ignored. A recent snapshot is the evidence that something else is doing
 * the reading, and it needs no flag anyone has to remember to set.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/tiktokSound", () => ({ fetchTikTokSoundStats: jest.fn() }));

import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { snapshotSounds } from "@/lib/sounds/snapshot";

const mockDb = db as unknown as {
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};
const mockFetch = fetchTikTokSoundStats as unknown as jest.Mock;

const HOUR = 60 * 60 * 1000;

function soundLastReadHoursAgo(hours: number | null) {
  return [
    {
      id: "sound-1",
      tiktokSoundId: "7546394810303694849",
      title: "Wherever I Go",
      artist: null,
      coverImageUrl: null,
      snapshots: hours === null ? [] : [{ usesCount: 45, recordedAt: new Date(Date.now() - hours * HOUR) }],
    },
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
  mockDb.tikTokSound.update.mockResolvedValue({});
  // What this path actually does against a music page, every time.
  mockFetch.mockResolvedValue(null);
});

it("leaves a sound alone when something read it recently", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(2));

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
  // Skipped, not failed: the alert is a ratio of failures, and a sound somebody
  // else is reading is not a failure of anything.
  expect(mockFetch).not.toHaveBeenCalled();
});

it("picks a sound back up once the reader has clearly stopped", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));

  const result = await snapshotSounds();

  // Tried, and failed the way this path always fails -- which is the honest
  // state to be in when nothing is reading the page any more.
  expect(mockFetch).toHaveBeenCalledWith("7546394810303694849");
  expect(result).toEqual({ snapshots: 0, failed: 1, skipped: 0 });
});

it("still tries a sound that has never been read at all", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));

  const result = await snapshotSounds();

  expect(mockFetch).toHaveBeenCalled();
  expect(result.failed).toBe(1);
});

it("does not silently do nothing when a person asked for this one sound", async () => {
  /* The Refresh button on a campaign runs this with a soundId. Skipping there
     would answer a deliberate click with no work and no explanation, however
     recently the worker happened to run. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(1));

  const result = await snapshotSounds({ soundId: "sound-1" });

  expect(mockFetch).toHaveBeenCalledWith("7546394810303694849");
  expect(result.skipped).toBe(0);
});

it("records the reading when this path does manage to get one", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  mockFetch.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  const written = mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;
  expect(written.usesCount).toBe(52);
  expect(written.deltaUses24h).toBe(7);
});
