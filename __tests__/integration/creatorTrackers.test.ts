/**
 * @jest-environment node
 *
 * The creator watchlist routes. Three things here matter more than the listing:
 *
 * - a creatorId arriving in a request body is proven to be the caller's before
 *   anything is written to it;
 * - untracking clears a flag and never deletes a creator, their posts or their
 *   activations, because a Creator is not a row that exists only to be tracked;
 * - the view aggregate is scoped through Campaign.orgId, since a creator can
 *   appear on more than one org's campaigns.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $queryRawUnsafe: jest.fn(),
  },
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { GET, POST } from "@/app/api/trackers/creators/route";
import { DELETE } from "@/app/api/trackers/creators/[id]/route";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

function req(url: string, method = "GET", payload?: unknown) {
  return new NextRequest(url, {
    method,
    ...(payload === undefined
      ? {}
      : { body: JSON.stringify(payload), headers: { "content-type": "application/json" } }),
  });
}

const BASE = "http://localhost:3009/api/trackers/creators";

const creatorRow = (over: Record<string, unknown> = {}) => ({
  id: "cr1",
  name: "sonheii",
  handle: "sonheii",
  platform: "TIKTOK",
  avatarUrl: null,
  followersCount: 0,
  trackedSince: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org-1", userId: "u1" });
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.$queryRawUnsafe.mockResolvedValue([]);
});

describe("GET /api/trackers/creators", () => {
  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await GET(req(BASE))).status).toBe(401);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });

  it("does not run the post aggregate when nothing is tracked", async () => {
    const res = await GET(req(BASE));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.creators).toEqual([]);
    // 18,708 post rows are not worth scanning to answer "nothing".
    expect(mockDb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("scopes the watchlist and the aggregate to the caller's org", async () => {
    mockDb.creator.findMany.mockResolvedValue([creatorRow()]);
    await GET(req(BASE));

    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-1", deletedAt: null, trackedSince: { not: null } },
      })
    );
    const [sql, orgId] = mockDb.$queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('JOIN "Campaign" c ON c.id = p."campaignId"');
    expect(sql).toContain('c."orgId" = $1');
    expect(orgId).toBe("org-1");
  });

  it("passes the cut-offs as UTC strings cast to timestamp", async () => {
    mockDb.creator.findMany.mockResolvedValue([creatorRow()]);
    await GET(req(`${BASE}?period=14d`));
    const [sql, , current, previous] = mockDb.$queryRawUnsafe.mock.calls[0];
    // postedAt is timestamp(3) WITHOUT time zone holding UTC; an offset-bearing
    // literal would have its offset discarded and shift the boundary.
    expect(sql).toContain("$2::timestamp");
    expect(String(current)).toMatch(/Z$/);
    expect(new Date(current as string).getTime() - new Date(previous as string).getTime()).toBe(
      14 * 24 * 3600_000
    );
  });

  it("reports a tracked creator we can measure nothing about without inventing zeros", async () => {
    mockDb.creator.findMany.mockResolvedValue([creatorRow()]);
    const body = await (await GET(req(BASE))).json();
    expect(body.creators).toHaveLength(1);
    expect(body.creators[0]).toMatchObject({
      handle: "sonheii",
      followersCount: null, // the column default, not an audience of zero
      metrics: { avgViews: null, changePercent: null, changeAbsentReason: "no-posts-in-window" },
    });
  });

  it("joins the aggregate onto the right creator and computes the change", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      creatorRow({ id: "cr1", handle: "a", followersCount: 2891236 }),
      creatorRow({ id: "cr2", handle: "b" }),
    ]);
    mockDb.$queryRawUnsafe.mockResolvedValue([
      // As Postgres sends them: numeric as string, count as bigint.
      { creatorId: "cr1", avgCurrent: "200", postsCurrent: BigInt(2), avgPrevious: "100", postsPrevious: BigInt(4) },
    ]);
    const body = await (await GET(req(BASE))).json();
    const a = body.creators.find((c: any) => c.handle === "a");
    const b = body.creators.find((c: any) => c.handle === "b");
    expect(a.metrics).toMatchObject({ avgViews: 200, changePercent: 100, postsInWindow: 2, postsInPrevious: 4 });
    expect(a.followersCount).toBe(2891236);
    expect(b.metrics.avgViews).toBeNull();
    // Measured first, unmeasured last.
    expect(body.creators[0].handle).toBe("a");
  });

  it("falls back to the default window and sort rather than trusting the query string", async () => {
    const body = await (await GET(req(`${BASE}?period=24h&sort=velocity`))).json();
    // 24h exists for sounds and not for creators; velocity is not a sort here.
    expect(body.period).toBe("7d");
    expect(body.sort).toBe("views");
    expect(body.windows).toEqual(["7d", "14d", "30d"]);
  });

  it("honours a window and sort it does implement", async () => {
    const body = await (await GET(req(`${BASE}?period=30d&sort=change`))).json();
    expect(body.period).toBe("30d");
    expect(body.sort).toBe("change");
  });
});

describe("POST /api/trackers/creators", () => {
  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await POST(req(BASE, "POST", { creatorId: "cr1" }))).status).toBe(401);
  });

  it("rejects a body without a creatorId", async () => {
    expect((await POST(req(BASE, "POST", {}))).status).toBe(400);
    expect((await POST(req(BASE, "POST", { creatorId: "" }))).status).toBe(400);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("survives a body that is not JSON", async () => {
    const bad = new NextRequest(BASE, { method: "POST", body: "not json", headers: { "content-type": "application/json" } });
    expect((await POST(bad)).status).toBe(400);
  });

  it("will not track another org's creator", async () => {
    // The id came from the request body, so the org filter is the only thing
    // standing between a caller and someone else's roster.
    mockDb.creator.findFirst.mockResolvedValue(null);
    const res = await POST(req(BASE, "POST", { creatorId: "someone-elses" }));
    expect(res.status).toBe(404);
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "someone-elses", orgId: "org-1", deletedAt: null } })
    );
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("tracks a creator it owns", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr1", trackedSince: null });
    const res = await POST(req(BASE, "POST", { creatorId: "cr1" }));
    expect(res.status).toBe(201);
    expect(mockDb.creator.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cr1" }, data: { trackedSince: expect.any(Date) } })
    );
  });

  it("tracking twice is not an error and does not reset the date", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr1", trackedSince: new Date("2026-01-01") });
    const res = await POST(req(BASE, "POST", { creatorId: "cr1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tracked: true, alreadyTracked: true });
    // That date is how long we have been watching; overwriting it loses the fact.
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/trackers/creators/[id]", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  it("refuses an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await DELETE(req(`${BASE}/cr1`, "DELETE"), ctx("cr1"))).status).toBe(401);
  });

  it("will not touch another org's creator", async () => {
    mockDb.creator.findFirst.mockResolvedValue(null);
    expect((await DELETE(req(`${BASE}/x`, "DELETE"), ctx("x"))).status).toBe(404);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("clears the flag and deletes nothing", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr1", trackedSince: new Date() });
    const res = await DELETE(req(`${BASE}/cr1`, "DELETE"), ctx("cr1"));
    expect(res.status).toBe(200);
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "cr1" }, data: { trackedSince: null } });
    // The load-bearing assertion: untracking is a watchlist edit, not a deletion.
    expect(mockDb.creator.delete).not.toHaveBeenCalled();
  });

  it("untracking an untracked creator is a no-op, not a write", async () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr1", trackedSince: null });
    const res = await DELETE(req(`${BASE}/cr1`, "DELETE"), ctx("cr1"));
    expect(res.status).toBe(200);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });
});
