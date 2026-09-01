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
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: () => ({
    readMusicEmbedHtml: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { GET } from "@/app/api/cron/sync-trackers/route";

const mockDb = db as unknown as {
  organization: { findMany: jest.Mock };
  tikTokSound: { findMany: jest.Mock; update: jest.Mock };
  soundTrackerSnapshot: { create: jest.Mock };
};
const mockFetch = fetchTikTokSoundStats as unknown as jest.Mock;

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
