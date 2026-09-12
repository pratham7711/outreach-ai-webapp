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
      if (sql.includes('"Activation"')) return Promise.resolve([{ activations: null }]);
      if (sql.includes('"Song"')) return Promise.resolve([audioRow]);
      return Promise.resolve([{ posts: BigInt(0), synced: null, views: null }]);
    }),
    activation: { findMany: jest.fn().mockResolvedValue([]) },
    campaign: { findUnique: jest.fn().mockResolvedValue(null) },
    soundTrackerSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const keys: string[][] = [];
let audioRow: { song: string | null; sound_at: Date | null } = { song: null, sound_at: null };

import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

const campaign = { id: "camp-1", orgId: "org-1", budget: null, currency: "USD" };

beforeEach(() => {
  keys.length = 0;
  audioRow = { song: null, sound_at: null };
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
