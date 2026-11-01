/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn() },
    viewFraudFlag: { findMany: jest.fn(), create: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { detectPostFlags, raiseFraudFlags, scanSweptPosts, type ScanPost } from "@/lib/fraud/scanPosts";
import { viewCheckCards, viewCheckDetail, viewCheckSeverity, viewCheckTitle, type ViewCheckFlag } from "@/lib/fraud/flagCopy";

const mdb = db as unknown as {
  post: { findMany: jest.Mock };
  viewFraudFlag: { findMany: jest.Mock; create: jest.Mock };
};

function snap(id: string, views: number, likes: number, at: string) {
  return { id, recordedAt: new Date(at), viewsCount: views, likesCount: likes, commentsCount: 0, sharesCount: 0, engagementRate: 0 };
}

function post(over: Partial<ScanPost> = {}): ScanPost {
  return {
    id: "p1",
    campaignId: "c1",
    creatorId: "cr1",
    viewsCount: 60000,
    likesCount: 40,
    commentsCount: 2,
    sharesCount: 1,
    engagementRate: 0.07,
    lastSyncedAt: new Date("2026-10-29T00:00:00Z"),
    platformMetrics: null,
    snapshots: [],
    ...over,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mdb.viewFraudFlag.findMany.mockResolvedValue([]);
  mdb.viewFraudFlag.create.mockImplementation(({ data }) => Promise.resolve({ id: `f-${data.postId}-${data.flagType}`, ...data }));
});

describe("detectPostFlags", () => {
  it("raises the engagement rules when likes were measured", () => {
    expect(detectPostFlags(post()).map((f) => f.flagType).sort()).toEqual(["BOT_PATTERN", "LOW_ENGAGEMENT"]);
  });

  it("does not call a post a bot because its likes were never read", () => {
    const unread = post({ likesCount: 0, commentsCount: 0, sharesCount: 0, platformMetrics: { __measured: ["views"] } });
    expect(detectPostFlags(unread)).toEqual([]);
  });

  it("keeps a view spike on a post whose likes were never read only if engagement moved", () => {
    const spiky = post({
      viewsCount: 9000,
      likesCount: 52,
      snapshots: [snap("s1", 1000, 50, "2026-10-01T00:00:00Z"), snap("s2", 9000, 52, "2026-10-02T00:00:00Z")],
    });
    expect(detectPostFlags(spiky).map((f) => f.flagType)).toEqual(["VIEW_SPIKE"]);
  });

  it("does not read a views-only reading after a jump as views with no engagement", () => {
    const viewsOnly = { ...snap("s2", 9000, 50, "2026-10-02T00:00:00Z"), platformMetrics: { __measured: ["views"] } };
    const honest = post({
      viewsCount: 9000,
      likesCount: 50,
      snapshots: [snap("s1", 1000, 50, "2026-10-01T00:00:00Z"), viewsOnly],
    });
    expect(detectPostFlags(honest).map((f) => f.flagType)).not.toContain("VIEW_SPIKE");
  });
});

describe("raiseFraudFlags", () => {
  it("skips a flag already on file, reviewed or not", async () => {
    mdb.viewFraudFlag.findMany.mockResolvedValue([{ postId: "p1", flagType: "LOW_ENGAGEMENT", evidence: {} }]);
    const { created, skipped } = await raiseFraudFlags("org-1", [post()]);
    expect(created.map((f) => f.flagType)).toEqual(["BOT_PATTERN"]);
    expect(skipped).toBe(1);
    expect(mdb.viewFraudFlag.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", postId: { in: ["p1"] } });
  });
});

describe("scanSweptPosts", () => {
  it("flags each post under its own campaign's org", async () => {
    mdb.post.findMany.mockResolvedValue([
      { ...post({ id: "a" }), campaign: { orgId: "org-1" } },
      { ...post({ id: "b", campaignId: "c2" }), campaign: { orgId: "org-2" } },
    ]);
    const r = await scanSweptPosts(["a", "b"]);
    expect(r).toEqual({ scanned: 2, flagged: 4, stopped: false });
    const orgs = mdb.viewFraudFlag.create.mock.calls.map((c) => [c[0].data.postId, c[0].data.orgId]);
    expect(orgs).toEqual(expect.arrayContaining([["a", "org-1"], ["b", "org-2"]]));
    expect(mdb.post.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["a", "b"] }, removedAt: null });
    /* Newest readings only: the run judges what it just read, not the whole history again. */
    expect(mdb.post.findMany.mock.calls[0][0].select.snapshots).toMatchObject({ orderBy: { recordedAt: "desc" }, take: 10 });
  });

  it("reads nothing once its deadline has passed", async () => {
    const r = await scanSweptPosts(["a"], { stopAtMs: Date.now() - 1 });
    expect(r).toEqual({ scanned: 0, flagged: 0, stopped: true });
    expect(mdb.post.findMany).not.toHaveBeenCalled();
  });
});

describe("flag copy", () => {
  it("says what the spike was, in numbers", () => {
    const text = viewCheckDetail({
      flagType: "VIEW_SPIKE",
      description: "raw",
      evidence: {
        viewsBefore: 28299, viewsAfter: 184000, marginalEngagementRate: 0.03, priorEngagementRate: 9.4,
        snapshotBeforeAt: "2026-10-29T16:57:04Z", snapshotAfterAt: "2026-10-29T22:57:04Z",
      },
    });
    expect(text).toContain("28,299");
    expect(text).toContain("184,000");
    expect(text).toContain("0.03%");
    expect(text).toContain("9.40%");
    expect(text).not.toMatch(/fraud/i);
  });

  it("never prints a negative engagement rate when interactions fell during the jump", () => {
    const text = viewCheckDetail({
      flagType: "VIEW_SPIKE",
      description: "raw",
      evidence: { viewsBefore: 3014, viewsAfter: 61000, marginalEngagementRate: -0.41, priorEngagementRate: 9.39 },
    });
    expect(text).not.toMatch(/-\d/);
    expect(text).toContain("did not grow with them");
    expect(text).toContain("9.39%");
  });

  it("falls back to the detector's sentence when the evidence is not shaped as expected", () => {
    expect(viewCheckDetail({ flagType: "VIEW_SPIKE", description: "raw sentence", evidence: null })).toBe("raw sentence");
  });

  it("names every rule and grades severity in plain words", () => {
    expect(viewCheckTitle("BOT_PATTERN")).toMatch(/almost no likes/);
    expect(viewCheckSeverity("CRITICAL")).toEqual({ label: "Strong signal", tone: "danger" });
    expect(viewCheckSeverity("LOW").tone).toBe("neutral");
  });

  const flag = (id: string, flagType: string, severity: string, evidence: unknown): ViewCheckFlag => ({
    id, postId: "p1", creatorId: "c1", flagType, severity, description: `raw ${id}`, evidence, isResolved: false, createdAt: "2026-10-29T00:00:00Z",
  });

  it("folds the two engagement checks on one post into one card at the stronger severity", () => {
    const cards = viewCheckCards([
      flag("f1", "BOT_PATTERN", "CRITICAL", { viewsCount: 61000, interactionRate: 0.07 }),
      flag("f2", "VIEW_SPIKE", "HIGH", null),
      flag("f3", "LOW_ENGAGEMENT", "MEDIUM", { viewsCount: 61000, engagementRate: 0.07 }),
    ]);
    expect(cards.map((c) => c.title)).toEqual([viewCheckTitle("LOW_ENGAGEMENT"), viewCheckTitle("VIEW_SPIKE")]);
    expect(cards[0]).toMatchObject({ key: "f3+f1", severity: "CRITICAL" });
    expect(cards[0].detail).toContain("61,000 views");
    expect(cards[0].detail).toContain("under both engagement checks");
  });

  it("keeps a lone engagement check as its own card", () => {
    const cards = viewCheckCards([flag("f1", "BOT_PATTERN", "HIGH", { viewsCount: 61000, interactionRate: 0.07 })]);
    expect(cards).toEqual([{ key: "f1", title: viewCheckTitle("BOT_PATTERN"), detail: expect.stringContaining("0.070%"), severity: "HIGH" }]);
  });
});
