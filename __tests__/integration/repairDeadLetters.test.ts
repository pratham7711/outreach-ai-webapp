/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as survey, POST as repair } from "@/app/api/admin/repair-dead-letters/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), updateMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";

const mockDb = db as any;

function deadPost(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    platform: "TIKTOK",
    campaignId: "campaign-1",
    syncFailCount: 5,
    syncDisabledAt: new Date("2026-08-20T00:00:00Z"),
    platformMetrics: null,
    ...overrides,
  };
}

/** A post whose last failed read recorded `reason`, the way applyPostMetrics does. */
function withReason(id: string, reason: string, overrides: Record<string, unknown> = {}) {
  return deadPost({
    id,
    platformMetrics: { __lastFetch: { reason, at: "2026-08-20T00:00:00Z", via: "cron" } },
    ...overrides,
  });
}

function req(method: "GET" | "POST", body?: unknown, url = "http://localhost/api/admin/repair-dead-letters") {
  return new NextRequest(url, {
    method,
    headers: { authorization: "Bearer admin-token", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const realToken = process.env.CC_SYNC_TOKEN;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  process.env.CC_SYNC_TOKEN = "admin-token";
  mockDb.post.updateMany.mockImplementation(({ where }: any) => ({
    count: where.id.in.length,
  }));
});

afterEach(() => {
  (console.warn as jest.Mock).mockRestore();
  if (realToken === undefined) delete process.env.CC_SYNC_TOKEN;
  else process.env.CC_SYNC_TOKEN = realToken;
});

describe("repair-dead-letters — the door", () => {
  it("404s when CC_SYNC_TOKEN is unset, so the route does not exist to a stranger", async () => {
    delete process.env.CC_SYNC_TOKEN;
    mockDb.post.findMany.mockResolvedValue([]);

    expect((await survey(req("GET"))).status).toBe(404);
    expect((await repair(req("POST", { confirm: true }))).status).toBe(404);
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
  });

  it("401s a wrong token without reading anything", async () => {
    mockDb.post.findMany.mockResolvedValue([]);
    const bad = new NextRequest("http://localhost/api/admin/repair-dead-letters", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token-xx" },
      body: JSON.stringify({ confirm: true }),
    });

    expect((await repair(bad)).status).toBe(401);
    expect(mockDb.post.findMany).not.toHaveBeenCalled();
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });
});

describe("repair-dead-letters — the SELECT", () => {
  it("reports the split without writing anything", async () => {
    mockDb.post.findMany.mockResolvedValue([
      withReason("ours-1", "platform-challenged"),
      withReason("ours-2", "backing-off"),
      withReason("ours-3", "credentials-rejected", { platform: "INSTAGRAM" }),
      withReason("theirs-1", "post-deleted"),
      withReason("theirs-2", "no-counts-published"),
      deadPost({ id: "unrecorded-1" }),
    ]);

    const res = await survey(req("GET"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.deadLettered).toBe(6);
    expect(body.repairable).toEqual({ ours: 3, unrecorded: 1 });
    expect(body.leftAlone).toBe(2);
    expect(body.byPlatform).toEqual({ TIKTOK: 5, INSTAGRAM: 1 });
    expect(body.byReason["platform-challenged"]).toBe(1);
    expect(body.byReason["(none recorded)"]).toBe(1);
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });

  it("only ever looks at posts that are actually disabled", async () => {
    mockDb.post.findMany.mockResolvedValue([]);
    await survey(req("GET"));
    expect(mockDb.post.findMany.mock.calls[0][0].where).toEqual({
      syncDisabledAt: { not: null },
    });
  });

  it("treats a reason slug it has never heard of as the platform's, not ours", async () => {
    // Forward compatibility, on the conservative side: a newer deployment could
    // record a reason this bundle does not know. Guessing "ours" would re-enable
    // posts on the strength of a slug nobody has read.
    mockDb.post.findMany.mockResolvedValue([withReason("future-1", "some-future-reason")]);

    const body = await (await survey(req("GET"))).json();

    expect(body.repairable).toEqual({ ours: 0, unrecorded: 0 });
    expect(body.leftAlone).toBe(1);
  });
});

describe("repair-dead-letters — the UPDATE", () => {
  it("does nothing without an explicit confirm, so a mistyped curl is harmless", async () => {
    mockDb.post.findMany.mockResolvedValue([withReason("ours-1", "platform-challenged")]);

    const body = await (await repair(req("POST"))).json();

    expect(body.dryRun).toBe(true);
    expect(body.wouldRepair).toBe(1);
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });

  it("clears the dead letter for our failures and leaves the platform's alone", async () => {
    mockDb.post.findMany.mockResolvedValue([
      withReason("ours-1", "platform-refused"),
      withReason("ours-2", "reader-timeout"),
      withReason("theirs-1", "post-deleted"),
      deadPost({ id: "unrecorded-1" }),
    ]);

    const body = await (await repair(req("POST", { confirm: true }))).json();

    expect(body.repaired).toBe(3);
    expect(body.leftAlone).toBe(1);
    expect(mockDb.post.updateMany).toHaveBeenCalledTimes(1);
    const arg = mockDb.post.updateMany.mock.calls[0][0];
    expect(arg.where.id.in.sort()).toEqual(["ours-1", "ours-2", "unrecorded-1"]);
  });

  /**
   * The blast radius of a mistake here. Clearing the flags puts a post back in
   * the queue; writing a counter or a lastSyncedAt would fabricate a measurement
   * and, worse, would look like a real one on a client report.
   */
  it("writes only the two flags — never a counter, a timestamp or a snapshot", async () => {
    mockDb.post.findMany.mockResolvedValue([withReason("ours-1", "platform-challenged")]);

    await repair(req("POST", { confirm: true }));

    expect(mockDb.post.updateMany.mock.calls[0][0].data).toEqual({
      syncFailCount: 0,
      syncDisabledAt: null,
    });
  });

  it("can be held to the recorded group only, for an operator who will not guess", async () => {
    mockDb.post.findMany.mockResolvedValue([
      withReason("ours-1", "platform-challenged"),
      deadPost({ id: "unrecorded-1" }),
    ]);

    const body = await (await repair(req("POST", { confirm: true, onlyRecorded: true }))).json();

    expect(body.repaired).toBe(1);
    expect(mockDb.post.updateMany.mock.calls[0][0].where.id.in).toEqual(["ours-1"]);
  });

  it("accepts onlyRecorded as a query param too", async () => {
    mockDb.post.findMany.mockResolvedValue([
      withReason("ours-1", "platform-challenged"),
      deadPost({ id: "unrecorded-1" }),
    ]);

    await repair(
      req("POST", { confirm: true }, "http://localhost/api/admin/repair-dead-letters?onlyRecorded=1"),
    );

    expect(mockDb.post.updateMany.mock.calls[0][0].where.id.in).toEqual(["ours-1"]);
  });

  it("is a no-op — not an error, and not an unbounded updateMany — when nothing is repairable", async () => {
    mockDb.post.findMany.mockResolvedValue([withReason("theirs-1", "post-deleted")]);

    const res = await repair(req("POST", { confirm: true }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repaired).toBe(0);
    expect(mockDb.post.updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent — a second run finds nothing left to do", async () => {
    mockDb.post.findMany.mockResolvedValueOnce([withReason("ours-1", "platform-challenged")]);
    const first = await (await repair(req("POST", { confirm: true }))).json();
    expect(first.repaired).toBe(1);

    // The first run cleared syncDisabledAt, so the survey query no longer sees it.
    mockDb.post.findMany.mockResolvedValueOnce([]);
    const second = await (await repair(req("POST", { confirm: true }))).json();
    expect(second.repaired).toBe(0);
  });
});
