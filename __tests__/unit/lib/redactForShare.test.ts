/**
 * @jest-environment node
 *
 * node, not jsdom: campaignPerformance imports the Prisma client for its
 * generated types, and the Prisma runtime needs TextEncoder.
 */
import { redactForShare } from "@/lib/reports/campaignPerformance";

/* Redaction has to happen here, on the server, because a client component's
   props are serialized into the RSC payload — hiding a column at render time
   leaves every value in the HTML for anyone who reads it. */

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  creatorId: "c1",
  name: "Maria Santos",
  avatarUrl: null,
  posts: 3,
  views: 1000,
  engagements: 50,
  engagementRate: 0.05,
  emv: 250,
  status: "DECLINED" as const,
  ...over,
});

const postRow = {
  id: "p1",
  platform: "TIKTOK",
  platformPostId: "7546394810303694849",
  postUrl: "https://www.tiktok.com/@mariasantos/video/7546394810303694849",
  thumbnailUrl: "https://p77-sg.tiktokcdn.com/thumb.jpeg",
  caption: "Maria Santos dancing to the track",
  postedAt: "2026-08-20T00:00:00.000Z",
  lastSyncedAt: "2026-08-22T00:00:00.000Z",
  creator: { id: "c1", name: "Maria Santos", handle: "mariasantos", avatarUrl: null },
  views: 1000,
  likes: 50,
  comments: 4,
  shares: null,
  saves: null,
  downloads: null,
  engagementRate: 0.05,
};

const data = {
  currency: "USD",
  kpis: { views: 1000, engagements: 50, engagementRate: 0.05, emv: 250 },
  timeSeries: [],
  platformSplit: [],
  leaderboard: [row()],
  posts: [postRow],
} as never;

const OPEN = { showCreators: true, showEmv: true, showStatuses: true };

describe("redactForShare", () => {
  it("strips the status when the link does not show statuses", () => {
    const out = redactForShare(data, { ...OPEN, showStatuses: false });
    expect(out.leaderboard[0].status).toBeNull();
    // Everything else the link does allow is untouched.
    expect(out.leaderboard[0].name).toBe("Maria Santos");
    expect(out.leaderboard[0].emv).toBe(250);
  });

  it("keeps the status when the link shows statuses", () => {
    expect(redactForShare(data, OPEN).leaderboard[0].status).toBe("DECLINED");
  });

  it("treats an omitted showStatuses as closed", () => {
    // The flag is optional on the parameter type, so an older caller that does
    // not pass it must not leak statuses by default.
    const out = redactForShare(data, { showCreators: true, showEmv: true });
    expect(out.leaderboard[0].status).toBeNull();
  });

  it("drops the whole leaderboard when creators are hidden, statuses included", () => {
    const out = redactForShare(data, { ...OPEN, showCreators: false });
    expect(out.leaderboard).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("Maria Santos");
    expect(JSON.stringify(out)).not.toContain("DECLINED");
  });

  it("keeps the post list but strips who posted, when creators are hidden", () => {
    // The numbers are the point of the report, so the rows survive -- but the
    // creator has to be gone from the data, not merely unrendered: props are
    // serialized into the RSC payload either way.
    const out = redactForShare(data, { ...OPEN, showCreators: false });

    expect(out.posts).toHaveLength(1);
    expect(out.posts[0].views).toBe(1000);
    expect(out.posts[0].creator).toBeNull();
    // The caption and thumbnail name the creator as surely as the handle does.
    expect(out.posts[0].caption).toBeNull();
    expect(out.posts[0].thumbnailUrl).toBeNull();
    const payload = JSON.stringify(out);
    expect(payload).not.toContain("Maria Santos");
    expect(payload).not.toContain("mariasantos");
  });

  it("leaves the post list alone when creators are shown", () => {
    const out = redactForShare(data, OPEN);
    expect(out.posts[0].creator?.handle).toBe("mariasantos");
    expect(out.posts[0].thumbnailUrl).toContain("tiktokcdn");
  });

  it("nulls money rather than zeroing it, so withheld is not mistaken for none", () => {
    const out = redactForShare(data, { ...OPEN, showEmv: false });
    expect(out.kpis.emv).toBeNull();
    expect(out.leaderboard[0].emv).toBeNull();
  });
});
