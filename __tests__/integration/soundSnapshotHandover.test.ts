/**
 * @jest-environment node
 *
 * What the nightly snapshot job decides, given a reading.
 *
 * The ladder that produces the reading -- embed over plain egress, the same
 * embed from a sandbox, then the music page -- moved out to
 * lib/platforms/tiktokAudioUsage.ts, where the hourly sweep reads it too, and
 * is tested there. What is left here is the job's own judgement, which is the
 * part that has actually been wrong in prod:
 *
 * The handover: a sound the hourly cron read an hour ago must not be read again
 * by this nightly job, or the two write duplicate snapshots and the second one
 * reports a delta of zero. A recent snapshot is the evidence, and it needs no
 * flag anyone has to remember to set. Skipped, not failed -- the nightly alert
 * is a ratio of failures, and a sound somebody else is reading is not one.
 *
 * And the zero: which rung answered decides whether a zero is a measurement.
 * The embed's zero is TikTok saying nothing uses this sound; the music page's
 * zero is that path failing to read. Same number, opposite meaning.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));
/* The reader is stubbed and fed an outcome per test. isMeasuredRung stays real:
   it is the rule under test, not a collaborator. */
const mockRead = jest.fn();
jest.mock("@/lib/platforms/tiktokAudioUsage", () => ({
  ...jest.requireActual("@/lib/platforms/tiktokAudioUsage"),
  readTikTokAudioUsage: (...args: unknown[]) => mockRead(...args),
}));
/* @vercel/sandbox is ESM and jest cannot parse it; nothing here needs a real
   sandbox, only the shape the reader would call. */
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: () => ({
    readMusicEmbedHtml: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { db } from "@/lib/db";
import type { UsageRung } from "@/lib/platforms/tiktokAudioUsage";
import { snapshotSounds } from "@/lib/sounds/snapshot";

const mockDb = db as unknown as {
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};

const HOUR = 60 * 60 * 1000;
const SOUND_ID = "7546394810303694849";

function soundLastReadHoursAgo(hours: number | null) {
  return [
    {
      id: "sound-1",
      tiktokSoundId: SOUND_ID,
      title: "Wherever I Go",
      artist: null,
      coverImageUrl: null,
      snapshots: hours === null ? [] : [{ usesCount: 45, recordedAt: new Date(Date.now() - hours * HOUR) }],
    },
  ];
}

/** The reader answered on `rung` with `usesCount`. */
function reads(rung: UsageRung, usesCount: number) {
  mockRead.mockResolvedValue(
    new Map([
      [SOUND_ID, { ok: true, rung, stats: { usesCount, title: null, artist: null, coverImageUrl: null } }],
    ])
  );
}

const written = () => mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
  mockDb.tikTokSound.update.mockResolvedValue({});
  // No rung answered, which is the honest default for a sound nobody can read.
  mockRead.mockReset().mockResolvedValue(new Map([[SOUND_ID, { ok: false, reason: "no-reading" }]]));
});

it("leaves a sound alone when something read it recently", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(2));

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
  // Skipped, not failed: the alert is a ratio of failures, and a sound somebody
  // else is reading is not a failure of anything. And nothing is asked of
  // TikTok at all -- a skipped sweep must cost no network.
  expect(mockRead).not.toHaveBeenCalled();
});

it("picks a sound back up once the reader has clearly stopped", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));

  const result = await snapshotSounds();

  expect(mockRead).toHaveBeenCalledWith([SOUND_ID], expect.anything());
  expect(result).toEqual({ snapshots: 0, failed: 1, skipped: 0 });
});

it("still tries a sound that has never been read at all", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));

  const result = await snapshotSounds();

  expect(mockRead).toHaveBeenCalled();
  expect(result.failed).toBe(1);
});

it("does not silently do nothing when a person asked for this one sound", async () => {
  /* The Refresh button on a campaign runs this with a soundId. Skipping there
     would answer a deliberate click with no work and no explanation, however
     recently the worker happened to run. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(1));

  const result = await snapshotSounds({ soundId: "sound-1" });

  expect(mockRead).toHaveBeenCalledWith([SOUND_ID], expect.anything());
  expect(result.skipped).toBe(0);
});

it("records the reading and the change it implies", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  reads("embed-direct", 52);

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(written().usesCount).toBe(52);
  expect(written().deltaUses24h).toBe(7);
});

it("floors videosAdded24h at zero when the count fell", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  reads("embed-direct", 44);

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  // 44 against a stored 45. A count of new videos cannot be negative; the signed
  // change keeps its sign.
  expect(written().videosAdded24h).toBe(0);
  expect(written().deltaUses24h).toBe(-1);
});

it("records a genuine zero from the embed", async () => {
  /* A brand's freshly uploaded audio on day one. statusCode 0 with videoCount 0
     is TikTok saying the sound exists and nothing uses it yet, and recording it
     is what makes tomorrow's delta true rather than inventing history. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));
  reads("embed-direct", 0);

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(written().usesCount).toBe(0);
});

it("records a zero the sandbox measured, because that is still an embed", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));
  reads("embed-sandbox", 0);

  expect(await snapshotSounds()).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
});

it("does not record a zero that came from the music page", async () => {
  /* Same number, different meaning. That path returns zero when it could not
     read, so writing it would stamp a real sound as unused and put a false
     cliff in the campaign report. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(null));
  reads("music-page", 0);

  const result = await snapshotSounds();

  expect(result).toEqual({ snapshots: 0, failed: 0, skipped: 1 });
  expect(mockDb.soundTrackerSnapshot.create).not.toHaveBeenCalled();
});

it("takes a non-zero music-page reading, which is the point of keeping the rung", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  reads("music-page", 52);

  expect(await snapshotSounds()).toEqual({ snapshots: 1, failed: 0, skipped: 0 });
  expect(written().usesCount).toBe(52);
});

it("does not count a sound the run never reached as a failure", async () => {
  /* Running out of time is not the fetcher failing, and counting it as one
     would page ops for the sole crime of tracking a lot of sounds. */
  mockDb.tikTokSound.findMany.mockResolvedValue(soundLastReadHoursAgo(20));
  mockRead.mockResolvedValue(new Map([[SOUND_ID, { ok: false, reason: "deadline" }]]));

  expect(await snapshotSounds()).toEqual({ snapshots: 0, failed: 0, skipped: 0 });
});

it("answers every row when two of them track the same sound", async () => {
  /* The reader is keyed by the platform's id, not by our row id, so one entry
     answers both rows -- and TikTok is asked once rather than twice. */
  mockDb.tikTokSound.findMany.mockResolvedValue([
    ...soundLastReadHoursAgo(20),
    { ...soundLastReadHoursAgo(20)[0], id: "sound-2" },
  ]);
  reads("embed-direct", 52);

  expect(await snapshotSounds()).toEqual({ snapshots: 2, failed: 0, skipped: 0 });
  expect(mockRead).toHaveBeenCalledWith([SOUND_ID, SOUND_ID], expect.anything());
});
