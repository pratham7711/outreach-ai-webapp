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
    $queryRaw: jest.fn().mockResolvedValue([{ posts: BigInt(0), synced: null, views: null }]),
    activation: { findMany: jest.fn().mockResolvedValue([]) },
    campaign: { findUnique: jest.fn().mockResolvedValue(null) },
    soundTrackerSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const keys: string[][] = [];

import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

const campaign = { id: "camp-1", orgId: "org-1", budget: null, currency: "USD" };

beforeEach(() => {
  keys.length = 0;
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
