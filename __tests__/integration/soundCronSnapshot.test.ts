/**
 * @jest-environment node
 *
 * The hourly sound cron's snapshot write.
 *
 * It computes the same 24-hour change as recordSoundSnapshot but keeps its own
 * copy of the arithmetic, because it derives the baseline from the whole window
 * rather than the newest reading. That copy drifted: it wrote the raw delta into
 * videosAdded24h, so when TikTok's uses figure fell by one -- which it does,
 * when a video using the sound is deleted -- prod reported "-1 videos added".
 *
 * A count of videos added cannot be negative. The signed change has its own
 * column and keeps its sign. These tests hold both halves of that apart.
 */
jest.mock("@/lib/db", () => ({
  db: {
    organization: { findMany: jest.fn() },
    tikTokSound: { findMany: jest.fn(), update: jest.fn() },
    soundTrackerSnapshot: { create: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/tiktokSound", () => ({ fetchTikTokSoundStats: jest.fn() }));
jest.mock("@/lib/platforms/tiktokSoundBrowser", () => ({
  openSoundBrowserSession: () => ({ read: jest.fn().mockResolvedValue(null), close: jest.fn() }),
}));
/* The embed is now the first rung and would otherwise reach the network. These
   tests are about the arithmetic the cron writes, so the reader is stubbed and
   fed a count per test. */
const mockEmbed = jest.fn();
jest.mock("@/lib/platforms/tiktokSoundEmbed", () => ({
  readTikTokSoundViaEmbed: (...a: any[]) => mockEmbed(...a),
}));
jest.mock("@/lib/alerts", () => ({
  ...jest.requireActual("@/lib/alerts"),
  alertOps: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: () => ({
    readMusicEmbedHtml: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { alertOps } from "@/lib/alerts";
import { GET } from "@/app/api/cron/sync-trackers/route";

const mockDb = db as unknown as {
  organization: { findMany: jest.Mock };
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};
const mockFetch = fetchTikTokSoundStats as unknown as jest.Mock;
const mockAlert = alertOps as unknown as jest.Mock;

const HOUR = 60 * 60 * 1000;

/**
 * History whose newest reading is old enough that the sound is due for a read
 * on the default 4-hourly cadence -- otherwise the sweep skips it and writes
 * nothing, which is a different test.
 */
function soundWithHistory(...usesNewestFirst: number[]) {
  return [
    {
      id: "sound-1",
      orgId: "org-1",
      tiktokSoundId: "7546394810303694849",
      snapshots: usesNewestFirst.map((usesCount, i) => ({
        usesCount,
        recordedAt: new Date(Date.now() - (26 + i * 12) * HOUR),
      })),
    },
  ];
}

async function runCron() {
  const req = new NextRequest("https://x/api/cron/sync-trackers", {
    headers: { authorization: "Bearer secret" },
  });
  return GET(req);
}

const written = () => mockDb.soundTrackerSnapshot.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "secret";
  mockDb.organization.findMany.mockResolvedValue([{ id: "org-1", uiConfig: null }]);
  mockDb.soundTrackerSnapshot.create.mockResolvedValue({});
  mockEmbed.mockReset().mockResolvedValue(null);
});

it("floors videosAdded24h at zero when the uses count fell", async () => {
  // 45 a day ago, 44 now: TikTok's figure went down by one. This is the shape
  // that put "-1 videos added" on the prod campaign report.
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(45));
  mockEmbed.mockResolvedValue({ usesCount: 44, title: null, artist: null, coverImageUrl: null });

  await runCron();

  expect(written().videosAdded24h).toBe(0);
});

it("keeps the sign on deltaUses24h, which is a change and not a count", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(45));
  mockEmbed.mockResolvedValue({ usesCount: 44, title: null, artist: null, coverImageUrl: null });

  await runCron();

  expect(written().deltaUses24h).toBe(-1);
});

it("passes a real rise through unchanged", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(40));
  mockEmbed.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });

  await runCron();

  expect(written().videosAdded24h).toBe(12);
  expect(written().deltaUses24h).toBe(12);
});

it("records zero rather than the lifetime total on a sound's first reading", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory());
  mockEmbed.mockResolvedValue({ usesCount: 46, title: null, artist: null, coverImageUrl: null });

  await runCron();

  // No predecessor to subtract: 46 uses is a level, not a day's growth.
  expect(written().videosAdded24h).toBe(0);
  expect(written().usesCount).toBe(46);
});

/**
 * velocityScore has one unit, and this route was the writer that disagreed.
 *
 * recordSoundSnapshot, the creator sweep and the seed all store
 * velocityBetween -- a percentage -- while this route stored velocityPerHour,
 * uses per hour, into the same column. One sound read by both jobs therefore
 * had a series that changed unit halfway along, and its only consumer (the
 * campaign audio card, via lib/reports/campaignPerformance) prints every point
 * with a "%" suffix.
 */
it("writes velocityScore as percent growth, the unit its reader prints", async () => {
  // 40 -> 52 is +30%. As uses/hour over the 26-hour gap it would be ~0.46.
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(40));
  mockEmbed.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });

  await runCron();

  expect(written().velocityScore).toBe(30);
});

it("counts a failed snapshot write as one sound, not the end of the sweep", async () => {
  const sounds = [
    { ...soundWithHistory(40)[0], id: "sound-bad", tiktokSoundId: "111" },
    { ...soundWithHistory(40)[0], id: "sound-good", tiktokSoundId: "222" },
  ];
  mockDb.tikTokSound.findMany.mockResolvedValue(sounds);
  mockEmbed.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });
  mockDb.soundTrackerSnapshot.create
    .mockRejectedValueOnce(new Error("deadlock detected"))
    .mockResolvedValue({});

  const body = await (await runCron()).json();

  expect(body.failed).toBe(1);
  expect(body.snapshotted).toBe(1);
  expect(mockDb.soundTrackerSnapshot.create).toHaveBeenCalledTimes(2);
  expect(body.decisions).toContainEqual({
    soundId: "sound-bad",
    action: "fail",
    reason: "write-failed",
  });
});

it("alerts once when the whole sweep failed, instead of failing in silence", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(40));
  // Every rung returns nothing: embed null, browser null, plain fetch null.
  mockEmbed.mockResolvedValue(null);
  mockFetch.mockResolvedValue(null);

  const body = await (await runCron()).json();

  expect(body.failed).toBe(1);
  expect(mockAlert).toHaveBeenCalledTimes(1);
  expect(mockAlert.mock.calls[0][0]).toMatchObject({
    source: "cron/sync-trackers",
    severity: "critical",
  });
});

it("stays quiet on a sweep that worked", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundWithHistory(40));
  mockEmbed.mockResolvedValue({ usesCount: 52, title: null, artist: null, coverImageUrl: null });

  await runCron();

  expect(mockAlert).not.toHaveBeenCalled();
});

/**
 * `orderBy: createdAt asc, take: 200` meant sound #201 was never read on any
 * run, for as long as the 200 above it existed -- a tracker that silently never
 * updates. The window is chosen by staleness now, so the tail rotates in.
 */
it("chooses the window by when each sound was last read, never-read first", async () => {
  const candidates = [
    { id: "fresh", snapshots: [{ recordedAt: new Date(Date.now() - 1 * HOUR) }] },
    { id: "never", snapshots: [] },
    { id: "stale", snapshots: [{ recordedAt: new Date(Date.now() - 40 * HOUR) }] },
  ];
  mockDb.tikTokSound.findMany.mockResolvedValueOnce(candidates).mockResolvedValueOnce([]);
  mockEmbed.mockResolvedValue(null);

  await runCron();

  const windowArgs = mockDb.tikTokSound.findMany.mock.calls[1][0];
  expect(windowArgs.where.id.in).toEqual(["never", "stale", "fresh"]);
});

it("keeps the window at MAX_SOUNDS, taking the staleest end of a longer list", async () => {
  const candidates = Array.from({ length: 260 }, (_, i) => ({
    id: `s-${i}`,
    // s-0 read longest ago, s-259 read most recently.
    snapshots: [{ recordedAt: new Date(Date.now() - (260 - i) * HOUR) }],
  }));
  mockDb.tikTokSound.findMany.mockResolvedValueOnce(candidates).mockResolvedValueOnce([]);
  mockEmbed.mockResolvedValue(null);

  await runCron();

  const ids = mockDb.tikTokSound.findMany.mock.calls[1][0].where.id.in;
  expect(ids).toHaveLength(200);
  expect(ids[0]).toBe("s-0");
  expect(ids).not.toContain("s-259");
});

/**
 * The delta columns mean "since the previous reading", not "over the last day".
 *
 * Two writers filled them: this cron used changeOverWindow(…, "24h"), whose
 * baseline is the oldest reading still inside the window, while
 * recordSoundSnapshot (manual Refresh, worker ingest) subtracts the reading
 * immediately before. The campaign audio card labels the column "Videos Added
 * (Since Last Sync)", so the second is the true one and the cron now agrees.
 *
 * Readings inside the window are what separates the two — the fixture above
 * puts everything 26h+ back, where both definitions collapse onto the same
 * baseline and the disagreement is invisible.
 */
function soundReadWithinTheDay() {
  return [
    {
      id: "sound-1",
      orgId: "org-1",
      tiktokSoundId: "7546394810303694849",
      snapshots: [
        // Newest first. 5h old, so the 4-hourly cadence says it is due.
        { usesCount: 900, recordedAt: new Date(Date.now() - 5 * HOUR) },
        { usesCount: 500, recordedAt: new Date(Date.now() - 20 * HOUR) },
      ],
    },
  ];
}

it("writes the change since the previous reading, not the whole day's gain", async () => {
  mockDb.tikTokSound.findMany.mockResolvedValue(soundReadWithinTheDay());
  mockEmbed.mockResolvedValue({ usesCount: 1000, title: null, artist: null, coverImageUrl: null });

  await runCron();

  // 1000 - 900. The 24-hour window would have said 1000 - 500 = 500.
  expect(written().videosAdded24h).toBe(100);
  expect(written().deltaUses24h).toBe(100);
});
