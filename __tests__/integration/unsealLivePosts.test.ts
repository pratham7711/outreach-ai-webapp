/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn() },
    postMetricSnapshot: { deleteMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { GET, POST } from "@/app/api/admin/unseal-live-posts/route";
import { SEAL_AGE_HOURS } from "@/lib/sync/cadence";

const mockDb = db as any;
const TOKEN = "test-token";
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function req(opts: { auth?: string | null; body?: unknown } = {}) {
  const headers = new Headers();
  const auth = opts.auth === undefined ? `Bearer ${TOKEN}` : opts.auth;
  if (auth !== null) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/admin/unseal-live-posts", {
    method: opts.body === undefined ? "GET" : "POST",
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

function sealedPost(over: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    platform: "YOUTUBE",
    postedAt: daysAgo(60),
    campaign: { id: "c-1", title: "Anime Template Edits" },
    snapshots: [{ id: "snap-1" }],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CC_SYNC_TOKEN = TOKEN;
  mockDb.postMetricSnapshot.deleteMany.mockResolvedValue({ count: 0 });
});

describe("unseal-live-posts — the guard rails", () => {
  it("404s when CC_SYNC_TOKEN is unset, so the route is inert by default", async () => {
    delete process.env.CC_SYNC_TOKEN;
    expect((await GET(req())).status).toBe(404);
    expect((await POST(req({ body: { confirm: true } }))).status).toBe(404);
    expect(mockDb.postMetricSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  it("401s on a wrong or absent token", async () => {
    mockDb.post.findMany.mockResolvedValue([]);
    expect((await GET(req({ auth: "Bearer wrong-token" }))).status).toBe(401);
    expect((await GET(req({ auth: null }))).status).toBe(401);
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it("GET never writes, whatever it finds", async () => {
    mockDb.post.findMany.mockResolvedValue([sealedPost()]);
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ dryRun: true, sealedInLiveCampaigns: 1, wouldUnseal: 1 });
    expect(mockDb.postMetricSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  /* The property that makes a mistyped curl survivable. */
  it("a POST without confirm:true reports and changes nothing", async () => {
    mockDb.post.findMany.mockResolvedValue([sealedPost()]);
    const body = await (await POST(req({ body: {} }))).json();
    expect(body.dryRun).toBe(true);
    expect(body.wouldUnseal).toBe(1);
    expect(mockDb.postMetricSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  it("only ever asks for live campaigns, and only for sealed posts", async () => {
    mockDb.post.findMany.mockResolvedValue([]);
    await GET(req());
    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where.campaign).toEqual({
      status: { in: ["IN_PROGRESS", "PENDING"] },
      archived: false,
      deletedAt: null,
    });
    expect(where.snapshots).toEqual({ some: { isFinalSnapshot: true } });
  });
});

describe("unseal-live-posts — what it will and will not free", () => {
  it("frees a post sealed mid-campaign and deletes only its final snapshots", async () => {
    mockDb.post.findMany.mockResolvedValue([
      sealedPost({ id: "p-1", snapshots: [{ id: "snap-1" }] }),
      sealedPost({ id: "p-2", platform: "TIKTOK", snapshots: [{ id: "snap-2" }] }),
    ]);
    mockDb.postMetricSnapshot.deleteMany.mockResolvedValue({ count: 2 });

    const body = await (await POST(req({ body: { confirm: true } }))).json();

    expect(body).toMatchObject({ ok: true, unsealed: 2, snapshotsDeleted: 2 });
    const where = mockDb.postMetricSnapshot.deleteMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: ["snap-1", "snap-2"] });
    /* Belt and braces: even though every id was gathered from a
       isFinalSnapshot-filtered relation, the delete restates the predicate. An
       ordinary measured snapshot must never be reachable from this route. */
    expect(where.isFinalSnapshot).toBe(true);
  });

  /* The churn guard. Unsealing a post the very next cron run is obliged to
     re-seal buys nothing and costs two writes an hour, forever. */
  it("refuses a post already past the seal horizon", async () => {
    const past = SEAL_AGE_HOURS / 24 + 20;
    mockDb.post.findMany.mockResolvedValue([
      sealedPost({ id: "p-old", postedAt: daysAgo(past), snapshots: [{ id: "snap-old" }] }),
      sealedPost({ id: "p-mid", postedAt: daysAgo(60), snapshots: [{ id: "snap-mid" }] }),
    ]);
    mockDb.postMetricSnapshot.deleteMany.mockResolvedValue({ count: 1 });

    const body = await (await POST(req({ body: { confirm: true } }))).json();

    expect(body.unsealed).toBe(1);
    expect(body.leftSealedPastHorizon).toBe(1);
    expect(mockDb.postMetricSnapshot.deleteMany.mock.calls[0][0].where.id).toEqual({
      in: ["snap-mid"],
    });
  });

  it("treats a post with no postedAt as eligible rather than guessing it is old", async () => {
    mockDb.post.findMany.mockResolvedValue([
      sealedPost({ id: "p-null", postedAt: null, snapshots: [{ id: "snap-null" }] }),
    ]);
    mockDb.postMetricSnapshot.deleteMany.mockResolvedValue({ count: 1 });

    // The survey reports it as unaged rather than assuming an age...
    const survey = await (await GET(req())).json();
    expect(survey.wouldUnseal).toBe(1);
    expect(survey.sample[0].ageDays).toBeNull();

    // ...and the apply path frees it.
    const body = await (await POST(req({ body: { confirm: true } }))).json();
    expect(body.unsealed).toBe(1);
    expect(body.leftSealedPastHorizon).toBe(0);
  });

  it("reports zero and writes nothing when there is nothing sealed", async () => {
    mockDb.post.findMany.mockResolvedValue([]);
    const body = await (await POST(req({ body: { confirm: true } }))).json();
    expect(body).toMatchObject({ ok: true, unsealed: 0 });
    expect(mockDb.postMetricSnapshot.deleteMany).not.toHaveBeenCalled();
  });

  it("groups the survey by platform and campaign, which is what makes it reviewable", async () => {
    mockDb.post.findMany.mockResolvedValue([
      sealedPost({ id: "a", platform: "YOUTUBE" }),
      sealedPost({ id: "b", platform: "YOUTUBE" }),
      sealedPost({ id: "c", platform: "TIKTOK", campaign: { id: "c-2", title: "Summer Drop" } }),
    ]);
    const body = await (await GET(req())).json();
    expect(body.eligible.byPlatform).toEqual({ YOUTUBE: 2, TIKTOK: 1 });
    expect(body.eligible.byCampaign).toEqual({ "Anime Template Edits": 2, "Summer Drop": 1 });
  });
});
