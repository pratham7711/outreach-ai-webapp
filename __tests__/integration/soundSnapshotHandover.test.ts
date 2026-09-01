/**
 * @jest-environment node
 *
 * Two separate things are under test here, and they used to be one.
 *
 * The handover: a sound the hourly cron read an hour ago must not be read again
 * by this nightly job, or the two write duplicate snapshots and the second one
 * reports a delta of zero. A recent snapshot is the evidence, and it needs no
 * flag anyone has to remember to set. Skipped, not failed -- the nightly alert
 * is a ratio of failures, and a sound somebody else is reading is not one.
 *
 * The reader: the embed page, which is what actually answers. The music page
 * carries no count and /api/music/detail/ answers empty without headers only
 * TikTok's own client script produces, so the plain fetch below has never
 * produced a reading. The fetch stays as a fallback, and the tests keep the two
 * rungs distinguishable because a zero means different things on each.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/tiktokSound", () => ({ fetchTikTokSoundStats: jest.fn() }));
jest.mock("@/lib/platforms/tiktokSoundEmbed", () => ({ readTikTokSoundViaEmbed: jest.fn() }));
/* @vercel/sandbox is ESM and jest cannot parse it; nothing here needs a real
   sandbox, only the shape the job calls. */
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: () => ({
    readMusicEmbedHtml: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { readTikTokSoundViaEmbed } from "@/lib/platforms/tiktokSoundEmbed";
import { snapshotSounds } from "@/lib/sounds/snapshot";

const mockDb = db as unknown as {
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};
const mockFetch = fetchTikTokSoundStats as unknown as jest.Mock;
const mockEmbed = readTikTokSoundViaEmbed as unknown as jest.Mock;

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
  // What each path actually does by default: the fetch has never read a music
  // page, and an embed that did not answer is "not measured", not zero.
  mockFetch.mockResolvedValue(null);
  mockEmbed.mockResolvedValue(null);
});

it("leaves a sound alone when something read it recently", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(2));

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
  // Skipped, not failed: the alert is a ratio of failures, and a sound somebody
  // else is reading is not a failure of anything.
  expect(mockEmbed).not.toHaveBeenCalled();
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

it("reads through the embed page and never reaches the fallback fetch", async () => {
  /* The rung that actually works. `title` is deliberately null: the music embed
     names the artist and the cover but never the track, so a reading from it
     must not be taken as evidence the stored title was wrong. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  mockEmbed.mockResolvedValue({
    usesCount: 44,
    title: null,
    artist: "Ellie Holcomb",
    coverImageUrl: "https://p19-common.tiktokcdn-us.com/cover.jpeg",
  });

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(mockEmbed).toHaveBeenCalledWith("7546394810303694849", expect.any(Function));
  expect(mockFetch).not.toHaveBeenCalled();
  const written = mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;
  expect(written.usesCount).toBe(44);
  // 44 against a stored 45. A count of new videos cannot be negative; the signed
  // change keeps its sign.
  expect(written.videosAdded24h).toBe(0);
  expect(written.deltaUses24h).toBe(-1);
});

it("records a genuine zero from the embed", async () => {
  /* A brand's freshly uploaded audio on day one. statusCode 0 with videoCount 0
     is TikTok saying the sound exists and nothing uses it yet, and recording it
     is what makes tomorrow's delta true rather than inventing history. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));
  mockEmbed.mockResolvedValue({ usesCount: 0, title: null, artist: null, coverImageUrl: null });

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data.usesCount).toBe(0);
});

it("does not record a zero that came from the fallback fetch", async () => {
  /* Same number, different meaning. The fetch path returns zero when it could
     not read the page, so writing it would stamp a real sound as unused and put
     a false cliff in the campaign report. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));
  mockFetch.mockResolvedValue({ usesCount: 0, title: null, artist: null, coverImageUrl: null });

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
  expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
});

it("falls back to the fetch when the embed refuses", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  mockFetch.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data.usesCount).toBe(52);
});

it("counts a sound as failed when the embed throws and the fetch is empty", async () => {
  // A thrown sandbox error must not take the whole run down with it.
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  mockEmbed.mockRejectedValue(new Error("sandbox boot failed"));

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 1, skipped: 0 });
});
