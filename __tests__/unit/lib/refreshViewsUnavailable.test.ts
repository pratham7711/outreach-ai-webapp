/**
 * @jest-environment node
 *
 * A refresh whose Instagram reads all came back without views used to record
 * measured = total with no reasons at all (2026-10-02/03, while Business
 * Discovery was throttled), so the run row said a clean refresh happened. A
 * read that measured but left views out is now counted under
 * "views-unavailable" in the run's reasons -- still measured, never retried.
 */
jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
    campaignRefreshRun: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));
jest.mock("@/lib/sync/syncPost", () => ({ syncPost: jest.fn() }));
jest.mock("@/lib/sounds/snapshot", () => ({ snapshotSounds: jest.fn() }));
jest.mock("@/lib/platforms/tiktokEgress", () => ({ openTikTokPostFetcher: jest.fn(() => undefined) }));

import { db } from "@/lib/db";
import { syncPost } from "@/lib/sync/syncPost";
import { readLackedViews, refreshCampaign } from "@/lib/sync/refreshCampaign";
import { describeReasons, summariseRefresh, VIEWS_UNAVAILABLE } from "@/lib/refreshSummary";
import { MEASURED_FIELDS_KEY } from "@/lib/metricDisplay";

type MockedDb = {
  campaign: { findFirst: jest.Mock };
  post: { findMany: jest.Mock };
  campaignRefreshRun: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};
const mockDb = db as unknown as MockedDb;
const mockSync = syncPost as jest.Mock;

const bag = (fields: string[]) => ({ [MEASURED_FIELDS_KEY]: fields });

const post = (i: number, platform: string, mediaType: string | null) => ({
  id: `post-${i}`,
  platform,
  mediaType,
  creatorId: `creator-${i}`,
  postUrl: `https://example.com/${i}`,
  thumbnailUrl: null,
  caption: null,
  platformMetrics: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", song: null });
  mockDb.campaignRefreshRun.findFirst.mockResolvedValue(null);
  mockDb.campaignRefreshRun.create.mockImplementation(async ({ data }: { data?: { total?: number } }) => ({
    id: "run-1",
    startedAt: new Date(),
    total: data?.total ?? 0,
    status: "running",
  }));
  mockDb.campaignRefreshRun.update.mockResolvedValue({ id: "run-1" });
});

describe("readLackedViews", () => {
  it("is true for a reel read without views", () => {
    expect(readLackedViews({ platform: "INSTAGRAM", mediaType: "REEL" }, bag(["comments"]))).toBe(true);
  });

  it("is false for a photo, which publishes no views anywhere", () => {
    expect(readLackedViews({ platform: "INSTAGRAM", mediaType: "POST" }, bag(["likes", "comments"]))).toBe(false);
  });

  it("is false when views came back, or when there is no list to judge by", () => {
    expect(readLackedViews({ platform: "INSTAGRAM", mediaType: "REEL" }, bag(["views", "comments"]))).toBe(false);
    expect(readLackedViews({ platform: "TIKTOK", mediaType: null }, null)).toBe(false);
  });
});

describe("the run's reasons", () => {
  it("counts measured reads that lacked views, without moving them out of measured", async () => {
    mockDb.post.findMany.mockResolvedValue([
      post(0, "INSTAGRAM", "REEL"),
      post(1, "INSTAGRAM", "REEL"),
      post(2, "INSTAGRAM", "POST"),
      post(3, "TIKTOK", "VIDEO"),
    ]);
    mockSync.mockImplementation(async (p: { id: string }) => {
      const fields = p.id === "post-3" ? ["views", "likes", "comments"] : ["likes", "comments"];
      return { status: "measured", post: { platformMetrics: bag(fields) } };
    });

    const outcome = await refreshCampaign({ orgId: "org-1", campaignId: "camp-1" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.measured).toBe(4);
    expect(outcome.result.reasons).toEqual({ [VIEWS_UNAVAILABLE]: 2 });
    expect(outcome.result.continuable).toBe(0);
    const runRow = mockDb.campaignRefreshRun.update.mock.calls.at(-1)[0].data;
    expect(runRow.reasons).toEqual({ [VIEWS_UNAVAILABLE]: 2 });
    expect(runRow.measured).toBe(4);
  });

  it("has wording in the debug breakdown and none in the toolbar sentence", () => {
    expect(describeReasons({ [VIEWS_UNAVAILABLE]: 9 })).toBe("9 updated without new views");
    /* Owner's call, 2026-09-03: the toolbar says a refresh happened and no more.
       The per-post "Views as of" label carries this instead. */
    expect(summariseRefresh({ total: 9, measured: 9, reasons: { [VIEWS_UNAVAILABLE]: 9 } })).toBe("Posts updated.");
  });
});
