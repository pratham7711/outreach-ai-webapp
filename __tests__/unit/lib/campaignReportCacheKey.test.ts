/**
 * @jest-environment node
 *
 * The report is cached for an hour under a key derived from the campaign's own
 * state. The currency is carried straight onto the report but is not part of
 * the stamp -- which only watches posts -- so a campaign switched from USD to
 * INR kept serving the old symbol until the entry expired.
 */
jest.mock("next/cache", () => ({
  unstable_cache: jest.fn((fn: () => unknown, keyParts: string[]) => {
    keys.push(keyParts);
    return fn;
  }),
}));

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    /* The stamp fires three tagged templates in one wave, so the mock answers by
       which table the SQL names rather than by call order -- Promise.all gives
       no order to rely on. */
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      postStampSql.push(sql);
      if (sql.includes('"Activation"')) return Promise.resolve([{ activations: null }]);
      if (sql.includes('"SongStreamSnapshot"')) return streamsAnswer();
      if (sql.includes('"Song"')) return Promise.resolve([audioRow]);
      return Promise.resolve([postRow]);
    }),
    activation: { findMany: jest.fn().mockResolvedValue([]) },
    campaign: { findUnique: jest.fn().mockResolvedValue(null) },
    soundTrackerSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const keys: string[][] = [];
let audioRow: { song: string | null; sound_at: Date | null } = { song: null, sound_at: null };
let postRow: { posts: bigint; synced: Date | null; views: string | null; removed?: Date | null } = { posts: BigInt(0), synced: null, views: null };
const postStampSql: string[] = [];
let streamsAnswer: () => Promise<{ streams_at: Date | null; streams_n?: number | null }[]> = () => Promise.resolve([{ streams_at: null }]);

import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
import { notRemovedSql } from "@/lib/posts/removed";

const campaign = { id: "camp-1", orgId: "org-1", budget: null, currency: "USD" };

beforeEach(() => {
  keys.length = 0;
  postStampSql.length = 0;
  audioRow = { song: null, sound_at: null };
  postRow = { posts: BigInt(0), synced: null, views: null };
  streamsAnswer = () => Promise.resolve([{ streams_at: null }]);
});

/* "Remove from campaign" is a soft remove (lib/posts/removed): the row stays,
   so the stamp counts only the live posts and also watches the newest
   removedAt -- otherwise a remove or a restore would keep serving the hour-old
   report with the wrong totals. */
it("stamps only the live posts, with the filter lib/posts/removed hands raw SQL", async () => {
  await computeCampaignPerformance(campaign);
  const sql = postStampSql.find((q) => q.includes('FROM "Post"'))!;
  expect(sql.split(`FILTER (WHERE ${notRemovedSql()})`)).toHaveLength(5);
  expect(sql).toContain('MAX("removedAt") AS removed');
});

it("moves the key when a post is removed or restored", async () => {
  postRow = { posts: BigInt(6), synced: null, views: "600", removed: null };
  await computeCampaignPerformance(campaign);
  postRow = { posts: BigInt(5), synced: null, views: "500", removed: new Date("2026-10-14T00:00:00Z") };
  await computeCampaignPerformance(campaign);
  // Restored: the campaign is exactly as it was before the remove, and so is its key.
  postRow = { posts: BigInt(6), synced: null, views: "600", removed: null };
  await computeCampaignPerformance(campaign);

  expect(keys).toHaveLength(3);
  expect(keys[1]).not.toEqual(keys[0]);
  expect(keys[2]).toEqual(keys[0]);
});

it("keys the cached report on the campaign currency", async () => {
  await computeCampaignPerformance(campaign);
  await computeCampaignPerformance({ ...campaign, currency: "INR" });

  expect(keys).toHaveLength(2);
  expect(keys[0]).toContain("USD");
  expect(keys[1]).toContain("INR");
  // Same campaign, same posts, same platforms -- only the currency moved, and
  // that alone has to make the two entries different.
  expect(keys[0]).not.toEqual(keys[1]);
});

it("still keys on the campaign id and the platform filter", async () => {
  await computeCampaignPerformance(campaign);
  await computeCampaignPerformance(campaign, ["TIKTOK"]);

  expect(keys[0]).toContain("camp-1");
  expect(keys[0]).toContain("all");
  expect(keys[1]).toContain("TIKTOK");
});

/* Attaching audio writes Campaign.songId and touches no Post row, so the
   post-derived stamp did not move and the page kept serving the entry that had
   audio: null -- for the full hour. Measured on prod 2026-09-12: PATCH 200, the
   songId written, /performance still answering null. */
it("moves the key when a campaign gains audio", async () => {
  await computeCampaignPerformance(campaign);
  audioRow = { song: "song-1", sound_at: null };
  await computeCampaignPerformance(campaign);

  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toEqual(keys[1]);
});

it("moves the key when a new sound reading lands", async () => {
  audioRow = { song: "song-1", sound_at: new Date("2026-09-12T00:00:00Z") };
  await computeCampaignPerformance(campaign);
  // The uses count and the velocity chart come from these snapshots, and the
  // same pass backfills the sound's title, artist and cover.
  audioRow = { song: "song-1", sound_at: new Date("2026-09-12T06:00:00Z") };
  await computeCampaignPerformance(campaign);

  expect(keys[0]).not.toEqual(keys[1]);
});

it("keeps the key stable when nothing about the audio moved", async () => {
  audioRow = { song: "song-1", sound_at: new Date("2026-09-12T00:00:00Z") };
  await computeCampaignPerformance(campaign);
  await computeCampaignPerformance(campaign);

  // Otherwise the hour of caching this key exists to buy is spent on every view.
  expect(keys[0]).toEqual(keys[1]);
});

/* The Spotify readings land once a day and touch no Post either, so the key
   has to watch them the way it watches the sound's snapshots. */
it("moves the key when a new Spotify reading lands", async () => {
  audioRow = { song: "song-1", sound_at: null };
  streamsAnswer = () => Promise.resolve([{ streams_at: new Date("2026-10-15T04:20:00Z") }]);
  await computeCampaignPerformance(campaign);
  streamsAnswer = () => Promise.resolve([{ streams_at: new Date("2026-10-16T04:20:00Z") }]);
  await computeCampaignPerformance(campaign);

  expect(keys[0]).not.toEqual(keys[1]);
});

it("moves the key when a Spotify reading is removed", async () => {
  audioRow = { song: "song-1", sound_at: null };
  const newest = new Date("2026-10-16T04:20:00Z");
  streamsAnswer = () => Promise.resolve([{ streams_at: newest, streams_n: 13 }]);
  await computeCampaignPerformance(campaign);
  streamsAnswer = () => Promise.resolve([{ streams_at: newest, streams_n: 1 }]);
  await computeCampaignPerformance(campaign);

  expect(keys[0]).not.toEqual(keys[1]);
});

it("still serves the report while the Spotify table does not exist", async () => {
  streamsAnswer = () => Promise.reject(Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2010" }));
  await expect(computeCampaignPerformance(campaign)).resolves.toMatchObject({ streams: null });
  expect(keys).toHaveLength(1);
});
