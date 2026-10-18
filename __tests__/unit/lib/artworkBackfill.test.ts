/**
 * @jest-environment node
 *
 * The one-off copy of artwork that predates its stores
 * (lib/media/artworkBackfill). Pinned: a dry run writes nothing, only items
 * with a fetchable picture are tried, held and lately-failed ones are left
 * alone so repeated calls end, and every org is covered.
 */
jest.mock("@/lib/db", () => ({
  db: {
    tikTokSound: { findMany: jest.fn() },
    campaign: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/sounds/coverStore", () => ({
  SOUND_COVER_RETRY_MS: 6 * 60 * 60 * 1000,
  captureSoundCover: jest.fn(),
}));
jest.mock("@/lib/campaigns/thumbnailCopy", () => ({
  CAMPAIGN_THUMBNAIL_RETRY_MS: 6 * 60 * 60 * 1000,
  captureCampaignThumbnail: jest.fn(),
}));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { captureSoundCover } from "@/lib/sounds/coverStore";
import { captureCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";
import { backfillArtwork } from "@/lib/media/artworkBackfill";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const soundCapture = captureSoundCover as jest.Mock;
const campaignCapture = captureCampaignThumbnail as jest.Mock;
const tiktok = (key: string) => `https://p16-sg.tiktokcdn.com/aweme/720x720/${key}.jpeg`;
const tiktokUs = (key: string) => `https://p16-common.tiktokcdn-us.com/tos-alisg-v-2774/${key}~tplv-obj.jpeg`;
const upload = (f: string) => `//x.cdn.bubble.io/${f}/image.png`;

beforeEach(() => {
  jest.resetAllMocks();
  mdb.tikTokSound.findMany.mockResolvedValue([
    { id: "s-held", coverImageUrl: tiktok("a"), songs: [], cover: { fetchedAt: new Date(), failedAt: null } },
    { id: "s-new", coverImageUrl: tiktok("b"), songs: [{ coverUrl: null }], cover: null },
    { id: "s-song-only", coverImageUrl: null, songs: [{ coverUrl: tiktok("c") }], cover: null },
    { id: "s-none", coverImageUrl: null, songs: [], cover: null },
    { id: "s-failed", coverImageUrl: tiktok("d"), songs: [], cover: { fetchedAt: null, sourceUrl: tiktok("d"), failedAt: new Date() } },
    // The same picture, failed at one address and offered at another: tried, not waited out.
    { id: "s-moved", coverImageUrl: tiktokUs("e"), songs: [], cover: { fetchedAt: null, sourceUrl: tiktok("e"), failedAt: new Date() } },
  ]);
  mdb.campaign.findMany.mockResolvedValue([
    { id: "c-held", thumbnailUrl: upload("f1"), thumbnailCopy: { fetchedAt: new Date(), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null } },
    { id: "c-new", thumbnailUrl: upload("f2"), thumbnailCopy: null },
    { id: "c-page", thumbnailUrl: "https://www.tiktok.com/music/x-1", thumbnailCopy: null },
    { id: "c-failed", thumbnailUrl: upload("f3"), thumbnailCopy: { fetchedAt: null, sourceUrl: "https://x.cdn.bubble.io/f3/image.png", failedAt: new Date() } },
  ]);
});

it("counts without fetching or writing on a dry run", async () => {
  const result = await backfillArtwork({ dryRun: true });
  expect(result.sounds).toMatchObject({ total: 6, held: 1, noPicture: 1, failedRecently: 1, toTry: 3 });
  expect(result.campaigns).toMatchObject({ total: 4, held: 1, noPicture: 1, failedRecently: 1, toTry: 1 });
  expect(result.remaining).toBe(4);
  expect(soundCapture).not.toHaveBeenCalled();
  expect(campaignCapture).not.toHaveBeenCalled();
});

it("reads every org, and only campaigns that are live with a thumbnail", async () => {
  await backfillArtwork({ dryRun: true });
  expect(mdb.tikTokSound.findMany.mock.calls[0][0]).not.toHaveProperty("where");
  expect(mdb.campaign.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, thumbnailUrl: { not: null } });
});

it("tries each sound with every link it has, and each campaign once", async () => {
  soundCapture.mockResolvedValue("kept");
  campaignCapture.mockResolvedValue("stored");
  const result = await backfillArtwork({ dryRun: false });

  expect(soundCapture.mock.calls.map((c) => [c[0], c[1]])).toEqual([
    ["s-new", [tiktok("b")]],
    ["s-song-only", [tiktok("c")]],
    ["s-moved", [tiktokUs("e")]],
  ]);
  expect(campaignCapture.mock.calls.map((c) => c[0])).toEqual(["c-new"]);
  expect(result.sounds.stored).toBe(3);
  expect(result.campaigns.stored).toBe(1);
  expect(result.remaining).toBe(0);
});

it("includes lately-failed items only when asked to retry", async () => {
  soundCapture.mockResolvedValue(null);
  campaignCapture.mockResolvedValue("failed");
  const result = await backfillArtwork({ dryRun: false, retryFailed: true });
  expect(soundCapture.mock.calls.map((c) => c[0])).toContain("s-failed");
  expect(campaignCapture.mock.calls.map((c) => c[0])).toContain("c-failed");
  expect(campaignCapture.mock.calls.find((c) => c[0] === "c-failed")?.[2]).toEqual({ retryFailed: true });
  expect(result.sounds.failed).toBe(4);
  expect(result.campaigns.failed).toBe(2);
});

it("stops at the batch limit and says how much is left", async () => {
  soundCapture.mockResolvedValue("kept");
  campaignCapture.mockResolvedValue("stored");
  const result = await backfillArtwork({ dryRun: false, limit: 1, concurrency: 1 });
  expect(soundCapture).toHaveBeenCalledTimes(1);
  expect(campaignCapture).not.toHaveBeenCalled();
  expect(result.remaining).toBe(3);
});
