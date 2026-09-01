/**
 * @jest-environment node
 *
 * The daily "Views over time" measurement.
 *
 * The chart used to be derived on read -- posts bucketed by publication date,
 * each contributing its current view count -- so the past moved every time a
 * post gained a view. These tests pin the three properties that make the
 * replacement a measurement instead: it is taken at a fixed time, a reading is a
 * level rather than a per-day delta, and a day that was never measured has no
 * point rather than a zero.
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRaw: jest.fn(),
    orgViewsSnapshot: { upsert: jest.fn() },
  },
}));

jest.mock("@/lib/alerts", () => ({
  alertOps: jest.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { alertOps } from "@/lib/alerts";
import { snapshotOrgViews, utcDayOf } from "@/lib/analytics/orgViewsSnapshot";
import { GET } from "@/app/api/cron/snapshot-org-views/route";

const mockDb = db as unknown as {
  $queryRaw: jest.Mock;
  orgViewsSnapshot: { upsert: jest.Mock };
};
const mockAlert = alertOps as jest.Mock;

/** Rows as Postgres returns them: COUNT(*) is a bigint, SUM() can be null. */
const row = (orgId: string, views: number, posts: number) => ({
  orgId,
  views,
  likes: 10,
  comments: 5,
  posts: BigInt(posts),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.$queryRaw.mockResolvedValue([]);
  mockDb.orgViewsSnapshot.upsert.mockResolvedValue({});
  process.env.CRON_SECRET = "test-secret";
});

const written = () => mockDb.orgViewsSnapshot.upsert.mock.calls.map((c) => c[0]);

// ─── the day key ────────────────────────────────────────────────────────────

describe("utcDayOf", () => {
  it("truncates to UTC midnight", () => {
    expect(utcDayOf(new Date("2026-09-01T03:30:12.482Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z"
    );
  });

  /* The cron runs at 03:30 UTC, which is 09:00 in Asia/Kolkata and the previous
     evening in Los Angeles. If the day key came from local time, the same run
     would file itself under two different dates depending on where the code
     happened to execute, and one day would end up with two readings while its
     neighbour had none. */
  it("gives one key per run regardless of the host timezone", () => {
    const lateUtc = utcDayOf(new Date("2026-09-01T23:59:59.000Z"));
    const earlyUtc = utcDayOf(new Date("2026-09-01T00:00:01.000Z"));
    expect(lateUtc.toISOString()).toBe(earlyUtc.toISOString());
  });
});

// ─── the reading ────────────────────────────────────────────────────────────

describe("snapshotOrgViews", () => {
  it("writes one row per org, keyed on the UTC day", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 347042223, 8443), row("org-2", 512, 3)]);

    const result = await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z") });

    expect(result).toEqual({ orgs: 2, written: 2, skipped: 0 });
    expect(written()[0].where).toEqual({
      orgId_day: { orgId: "org-1", day: new Date("2026-09-01T00:00:00Z") },
    });
    expect(written()[0].create).toMatchObject({
      orgId: "org-1",
      viewsCount: 347042223,
      postsCount: 8443,
    });
  });

  /* A reading is the lifetime total, not the day's growth. Storing a delta would
     make the chart unreconstructable after a missed day, and would disagree with
     the "Total views" tile beside it, which is also a lifetime figure. */
  it("stores the lifetime level, not a delta against yesterday", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1000, 2)]);
    await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z") });
    expect(written()[0].create.viewsCount).toBe(1000);

    mockDb.orgViewsSnapshot.upsert.mockClear();
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1600, 2)]);
    await snapshotOrgViews({ now: new Date("2026-09-02T03:30:00Z") });
    // 1600, not the 600 it gained.
    expect(written()[0].create.viewsCount).toBe(1600);
  });

  /* Upsert, not create: a retry after a partial failure must replace the day's
     reading rather than leave two rows for one day, which would make the
     DISTINCT ON in the chart query pick an arbitrary one. */
  it("replaces the day's reading on a re-run instead of adding a second", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1000, 2)]);
    await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z") });

    const call = written()[0];
    expect(call.update).toMatchObject({ viewsCount: 1000, postsCount: 2 });
    expect(call.where.orgId_day.day).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  /* A zero row is indistinguishable from a measurement of zero once it is in the
     table, and it draws a flat line along the bottom of the chart for an org
     that simply has not started -- which reads as "your posts have no views". */
  it("skips an org with no posts rather than writing a zero", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 0, 0), row("org-2", 90, 1)]);

    const result = await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z") });

    expect(result).toEqual({ orgs: 2, written: 1, skipped: 1 });
    expect(written()).toHaveLength(1);
    expect(written()[0].create.orgId).toBe("org-2");
  });

  it("excludes soft-deleted campaigns from the reading", async () => {
    await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z") });
    const sql = mockDb.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain('c."deletedAt" IS NULL');
    // The tenant boundary is the join through Campaign; Post has no orgId.
    expect(sql).toContain('JOIN "Campaign" c ON c.id = p."campaignId"');
  });

  it("writes nothing on a dry run", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1000, 2)]);

    const result = await snapshotOrgViews({ now: new Date("2026-09-01T03:30:00Z"), dryRun: true });

    expect(result).toEqual({ orgs: 1, written: 1, skipped: 0 });
    expect(mockDb.orgViewsSnapshot.upsert).not.toHaveBeenCalled();
  });
});

// ─── the cron route ─────────────────────────────────────────────────────────

describe("GET /api/cron/snapshot-org-views", () => {
  const req = (url = "http://localhost/api/cron/snapshot-org-views", secret = "test-secret") =>
    new NextRequest(url, { headers: { authorization: `Bearer ${secret}` } });

  it("rejects a request without the cron secret", async () => {
    const res = await GET(new NextRequest("http://localhost/api/cron/snapshot-org-views"));
    expect(res.status).toBe(401);
    expect(mockDb.orgViewsSnapshot.upsert).not.toHaveBeenCalled();
  });

  it("rejects a wrong cron secret", async () => {
    const res = await GET(req(undefined, "not-the-secret"));
    expect(res.status).toBe(401);
  });

  it("takes the reading and reports what it wrote", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1000, 2)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgs: 1, written: 1, skipped: 0, dryRun: false });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("honours dryRun=1", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 1000, 2)]);

    const res = await GET(req("http://localhost/api/cron/snapshot-org-views?dryRun=1"));

    expect(await res.json()).toMatchObject({ dryRun: true, written: 1 });
    expect(mockDb.orgViewsSnapshot.upsert).not.toHaveBeenCalled();
  });

  /* A measured series has no point for a day the cron missed, and a reader
     cannot tell a missing measurement from a flat one -- so a run that writes
     nothing while orgs exist has to be loud. */
  it("alerts when orgs exist but nothing was written", async () => {
    mockDb.$queryRaw.mockResolvedValue([row("org-1", 0, 0)]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "cron/snapshot-org-views", severity: "critical" })
    );
  });

  it("does not alert for an instance with no orgs at all", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    await GET(req());
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("alerts and 500s when the reading throws", async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error("connection terminated unexpectedly"));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(mockAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Daily org views snapshot crashed" })
    );
  });
});
