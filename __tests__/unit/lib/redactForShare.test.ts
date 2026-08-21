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

const data = {
  currency: "USD",
  kpis: { views: 1000, engagements: 50, engagementRate: 0.05, emv: 250 },
  timeSeries: [],
  platformSplit: [],
  leaderboard: [row()],
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

  it("nulls money rather than zeroing it, so withheld is not mistaken for none", () => {
    const out = redactForShare(data, { ...OPEN, showEmv: false });
    expect(out.kpis.emv).toBeNull();
    expect(out.leaderboard[0].emv).toBeNull();
  });
});
