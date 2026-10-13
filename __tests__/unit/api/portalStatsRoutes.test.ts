/**
 * @jest-environment node
 *
 * GET /api/portal/stats and GET /api/portal/accounts/public: the creator's own
 * history and public profiles, gated on proven ownership.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
    creatorTrackerSnapshot: { findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));

import { GET as stats } from "@/app/api/portal/stats/route";
import { GET as publicProfiles } from "@/app/api/portal/accounts/public/route";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const session = { id: "s-1", creatorUserId: "cu-1", email: "c@example.test", name: "Fake", handle: "fake_creator_one" };

beforeEach(() => {
  jest.clearAllMocks();
  (getCreatorSession as jest.Mock).mockResolvedValue(session);
  (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([
    { id: "cr-1", orgId: "org-1" },
    { id: "cr-2", orgId: "org-2" },
  ]);
  mdb.creator.findMany.mockResolvedValue([]);
  mdb.post.findMany.mockResolvedValue([]);
  mdb.creatorSocialAccount.findMany.mockResolvedValue([]);
  mdb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
});

describe("GET /api/portal/stats", () => {
  it("401s without a session", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await stats()).status).toBe(401);
  });

  it("reads nothing for a login with no proven roster row", async () => {
    (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([]);
    expect(await (await stats()).json()).toEqual({ trends: [], campaignPosts: [] });
    expect(mdb.creator.findMany).not.toHaveBeenCalled();
  });

  it("merges two agencies' readings of the same profile into one line, one point a day", async () => {
    mdb.creator.findMany.mockResolvedValue([
      {
        id: "cr-1",
        platform: "TIKTOK",
        handle: "@Fake_Creator_One",
        trackerSnapshots: [
          { followersCount: 1200, recordedAt: new Date("2026-09-02T10:00:00Z") },
          { followersCount: 1000, recordedAt: new Date("2026-09-01T10:00:00Z") },
        ],
      },
      {
        id: "cr-2",
        platform: "TIKTOK",
        handle: "fake_creator_one",
        trackerSnapshots: [{ followersCount: 1100, recordedAt: new Date("2026-09-01T18:00:00Z") }],
      },
      { id: "cr-3", platform: "YOUTUBE", handle: "nothing_yet", trackerSnapshots: [] },
    ]);
    const body = await (await stats()).json();
    expect(body.trends).toEqual([
      {
        platform: "TIKTOK",
        handle: "Fake_Creator_One",
        source: "public_profile",
        points: [
          { day: "2026-09-01", followers: 1100 },
          { day: "2026-09-02", followers: 1200 },
        ],
      },
    ]);
    expect(mdb.creator.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["cr-1", "cr-2"] }, deletedAt: null });
  });

  /* The rows arrive newest first, and the old loop let the last row written win:
     the day's EARLIEST reading, or whichever agency's row came second. */
  it("keeps the day's latest reading, whatever order the rows arrive in", async () => {
    mdb.creator.findMany.mockResolvedValue([
      {
        id: "cr-1",
        platform: "TIKTOK",
        handle: "fake_creator_one",
        trackerSnapshots: [
          { followersCount: 1300, recordedAt: new Date("2026-09-01T22:00:00Z") },
          { followersCount: 1000, recordedAt: new Date("2026-09-01T02:00:00Z") },
        ],
      },
      {
        id: "cr-2",
        platform: "TIKTOK",
        handle: "fake_creator_one",
        trackerSnapshots: [{ followersCount: 1100, recordedAt: new Date("2026-09-01T12:00:00Z") }],
      },
    ]);
    const body = await (await stats()).json();
    expect(body.trends[0].points).toEqual([{ day: "2026-09-01", followers: 1300 }]);
  });

  it("shows Instagram reach and saves only where they were measured", async () => {
    const base = {
      postUrl: "https://example.test/p/1",
      caption: null,
      thumbnailUrl: null,
      postedAt: new Date("2026-09-10T00:00:00Z"),
      viewsCount: 500,
      likesCount: 20,
      commentsCount: 0,
      lastSyncedAt: new Date("2026-09-11T00:00:00Z"),
      campaign: { title: "Autumn Drop" },
    };
    mdb.post.findMany.mockResolvedValue([
      { ...base, id: "p-ig", platform: "INSTAGRAM", reachCount: 900, savesCount: 0, platformMetrics: { __measured: ["views", "likes", "comments", "reach"] } },
      { ...base, id: "p-tt", platform: "TIKTOK", reachCount: 0, savesCount: 0, platformMetrics: null },
    ]);
    const { campaignPosts } = await (await stats()).json();
    expect(campaignPosts[0]).toMatchObject({ id: "p-ig", reach: 900, saves: null, comments: 0, views: 500 });
    expect(campaignPosts[1]).toMatchObject({ id: "p-tt", reach: null, saves: null });
    expect(mdb.post.findMany.mock.calls[0][0].where).toEqual({
      creatorId: { in: ["cr-1", "cr-2"] },
      campaign: { deletedAt: null },
      removedAt: null,
    });
  });
});

describe("GET /api/portal/accounts/public", () => {
  it("401s without a session", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await publicProfiles()).status).toBe(401);
  });

  it("lists profiles read publicly, leaving out platforms the creator connected", async () => {
    mdb.creator.findMany.mockResolvedValue([
      { id: "cr-1", platform: "TIKTOK", handle: "@fake_creator_one" },
      { id: "cr-2", platform: "INSTAGRAM", handle: "fake_creator_one" },
    ]);
    mdb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "cr-2", platform: "INSTAGRAM", handle: "fake_creator_one", origin: "oauth" },
      { creatorId: "cr-1", platform: "YOUTUBE", handle: "@FakeChannel", origin: "manual" },
    ]);
    mdb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ recordedAt: new Date("2026-09-30T00:00:00Z") });

    const { profiles } = await (await publicProfiles()).json();
    expect(profiles).toEqual([
      { platform: "TIKTOK", handle: "fake_creator_one", lastReadAt: "2026-09-30T00:00:00.000Z" },
      { platform: "YOUTUBE", handle: "FakeChannel", lastReadAt: "2026-09-30T00:00:00.000Z" },
    ]);
  });

  it("returns nothing for a login with no proven roster row", async () => {
    (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([]);
    expect(await (await publicProfiles()).json()).toEqual({ profiles: [] });
  });
});
