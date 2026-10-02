/**
 * @jest-environment node
 *
 * The Creators tab, paged (plan §12 F3).
 *
 * It used to read every tracked creator's every reading -- a nested `take` is
 * applied in memory, after the rows are read -- which for the big agency was
 * about 185k rows per view. What must hold now:
 * - the order is decided over every tracked creator before the page is cut;
 * - only the page's creators have readings read, and only the window's;
 * - a creator last read before the window is still shown as read, not pending;
 * - page and pageSize are bounded.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
    tikTokSound: { count: jest.fn() },
    organization: { findUnique: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { orgFixture } from "../helpers/orgFixture";
import { GET } from "@/app/api/trackers/creators/route";
import { TRACKER_PAGE_SIZE_DEFAULT, TRACKER_PAGE_SIZE_MAX } from "@/lib/trackers/creatorPage";

const mockDb = db as any;
const BASE = "http://localhost:3009/api/trackers/creators";
const NOW = new Date("2026-10-20T00:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

/** A full page row, as the second findMany selects it. */
const pageRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Creator ${id}`,
  handle: `fake_${id}`,
  platform: "TIKTOK",
  avatarUrl: null,
  followersCount: 0,
  trackedSince: new Date("2026-09-01T00:00:00Z"),
  trackerLastAttemptAt: null,
  trackerLastError: null,
  topPosts: null,
  topPostsAt: null,
  topPostsSource: null,
  trackerSnapshots: [],
  ...over,
});

/** An anchor row as the LATERAL query returns it; only r1 and m1 filled. */
const anchorRow = (id: string, views: number, at: Date, followers = 1000) => ({
  id,
  r1At: at,
  r1Followers: followers,
  r1Views: views,
  r2At: null,
  r2Followers: null,
  r2Views: null,
  m1At: views > 0 ? at : null,
  m1Followers: views > 0 ? followers : null,
  m1Views: views > 0 ? views : null,
  m2At: null,
  m2Followers: null,
  m2Views: null,
  wAt: null,
  wFollowers: null,
  wViews: null,
});

/** The light list, the page fetch, and the two raw queries, told apart. */
function arrange({
  tracked,
  anchors,
  pages = (ids: string[]) => ids.map((id) => pageRow(id)),
}: {
  tracked: string[];
  anchors: Record<string, unknown>[];
  pages?: (ids: string[]) => unknown[];
}) {
  mockDb.creator.findMany.mockImplementation((args: { where: { id?: { in: string[] } } }) =>
    Promise.resolve(
      args.where.id ? pages(args.where.id.in) : tracked.map((id) => ({ id, followersCount: 0 }))
    )
  );
  mockDb.$queryRawUnsafe.mockImplementation((sql: string) =>
    Promise.resolve(sql.includes("LATERAL") ? anchors : [])
  );
}

const get = async (qs = "") => {
  const res = await GET(new NextRequest(`${BASE}${qs}`));
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", userId: "u1" });
  mockDb.organization.findUnique.mockResolvedValue(orgFixture());
});
afterEach(() => jest.useRealTimers());

describe("the order is decided before the page is cut", () => {
  it("puts the biggest creator on page 1 even when it was tracked last", async () => {
    arrange({
      tracked: ["a", "b", "c"], // newest-tracked first, the order a tie keeps
      anchors: [anchorRow("a", 100, hoursAgo(2)), anchorRow("b", 50_000, hoursAgo(2)), anchorRow("c", 900, hoursAgo(2))],
    });
    const one = await get("?pageSize=1&page=1");
    const two = await get("?pageSize=1&page=2");
    const three = await get("?pageSize=1&page=3");
    expect([one, two, three].map((p) => p.body.creators.map((c: { id: string }) => c.id))).toEqual([["b"], ["c"], ["a"]]);
    expect(one.body).toMatchObject({ total: 3, page: 1, pageSize: 1, pageCount: 3 });
  });

  it("ranks on followers from the newest reading when asked", async () => {
    arrange({
      tracked: ["a", "b"],
      anchors: [anchorRow("a", 0, hoursAgo(2), 5_000), anchorRow("b", 0, hoursAgo(2), 90_000)],
    });
    const { body } = await get("?sort=followers&pageSize=1");
    expect(body.creators.map((c: { id: string }) => c.id)).toEqual(["b"]);
  });

  it("probes the anchors inside the caller's org, for every tracked creator", async () => {
    arrange({ tracked: ["a", "b"], anchors: [] });
    await get();
    const call = mockDb.$queryRawUnsafe.mock.calls.find(([sql]: [string]) => sql.includes("LATERAL"));
    const [sql, orgId, ids, viewsFrom] = call;
    expect(sql).toContain('c."orgId" = $1');
    expect(sql).toContain('c.id = ANY($2::text[])');
    // Every probe is a LIMIT 1 on the (creatorId, recordedAt) index.
    expect(sql.match(/LIMIT 1/g)).toHaveLength(5);
    expect(orgId).toBe("org-1");
    expect(ids).toEqual(["a", "b"]);
    expect(String(viewsFrom)).toMatch(/Z$/);
  });
});

describe("only the page is read", () => {
  it("reads readings for the page's creators alone, bounded to the window in SQL", async () => {
    const tracked = Array.from({ length: 120 }, (_, i) => `cr${String(i).padStart(3, "0")}`);
    arrange({ tracked, anchors: [] });
    const { body } = await get("?period=14d");
    expect(body.creators).toHaveLength(TRACKER_PAGE_SIZE_DEFAULT);
    expect(body).toMatchObject({ total: 120, pageCount: 3 });

    const pageCall = mockDb.creator.findMany.mock.calls.find(([a]: [{ where: { id?: unknown } }]) => a.where.id)[0];
    expect(pageCall.where).toMatchObject({ orgId: "org-1", deletedAt: null, trackedSince: { not: null } });
    expect(pageCall.where.id.in).toHaveLength(TRACKER_PAGE_SIZE_DEFAULT);
    const snaps = pageCall.select.trackerSnapshots;
    expect(snaps.where).toEqual({ recordedAt: { gte: new Date(NOW.getTime() - 14 * 24 * 3600_000) } });
    // A nested take is applied in memory and bounds nothing; it is not relied on.
    expect(snaps.take).toBeUndefined();

    // The light list carries no readings at all.
    const lightCall = mockDb.creator.findMany.mock.calls.find(([a]: [{ where: { id?: unknown } }]) => !a.where.id)[0];
    expect(lightCall.select).toEqual({ id: true, followersCount: true });
  });

  it("caps pageSize and falls back on nonsense", async () => {
    const tracked = Array.from({ length: 450 }, (_, i) => `cr${i}`);
    arrange({ tracked, anchors: [] });
    expect((await get("?pageSize=10000")).body.creators).toHaveLength(TRACKER_PAGE_SIZE_MAX);
    expect((await get("?pageSize=-3&page=abc")).body).toMatchObject({ page: 1, pageSize: TRACKER_PAGE_SIZE_DEFAULT });
  });

  it("answers a page past the end with the last page", async () => {
    arrange({ tracked: ["a", "b", "c"], anchors: [] });
    const { body } = await get("?pageSize=2&page=9");
    expect(body.page).toBe(2);
    expect(body.creators).toHaveLength(1);
  });

  it("searches name and handle in the database", async () => {
    arrange({ tracked: [], anchors: [] });
    const { body } = await get("?q=%20sonh%20");
    expect(body).toMatchObject({ creators: [], total: 0, q: "sonh" });
    expect(mockDb.creator.findMany.mock.calls[0][0].where.OR).toEqual([
      { name: { contains: "sonh", mode: "insensitive" } },
      { handle: { contains: "sonh", mode: "insensitive" } },
    ]);
  });
});

describe("readings from before the window still count", () => {
  it("shows a creator last read three days ago as read, not as never read", async () => {
    arrange({
      tracked: ["old"],
      anchors: [anchorRow("old", 4_000, hoursAgo(72), 12_345)],
      // Nothing inside a 7-day window would come back from the bounded read
      // for a creator read before it; here the window is empty on purpose.
      pages: (ids) => ids.map((id) => pageRow(id, { trackerSnapshots: [] })),
    });
    const { body } = await get("?period=7d");
    const c = body.creators[0];
    expect(c.health).toBe("regressed");
    expect(c.lastReadAt).toBe(hoursAgo(72).toISOString());
    expect(c.followersCount).toBe(12_345);
    expect(c.views.avgViews).toBe(4_000);
    expect(c.snapshotCount).toBe(1);
  });

  it("finds a follower baseline in the window and the latest reading from the anchors", async () => {
    arrange({
      tracked: ["x"],
      anchors: [anchorRow("x", 0, hoursAgo(1), 1_100)],
      pages: (ids) =>
        ids.map((id) =>
          pageRow(id, {
            trackerSnapshots: [
              { followersCount: 1_100, avgViews: 0, recordedAt: hoursAgo(1) },
              { followersCount: 1_000, avgViews: 0, recordedAt: hoursAgo(100) },
            ],
          })
        ),
    });
    const { body } = await get("?period=7d");
    expect(body.creators[0]).toMatchObject({ followersCount: 1_100, followersDelta: 100, followersChangePercent: 10, health: "live" });
    // The same reading from both sources is counted once.
    expect(body.creators[0].snapshotCount).toBe(2);
  });
});
