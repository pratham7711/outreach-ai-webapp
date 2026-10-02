/**
 * @jest-environment node
 *
 * videos.batchGetStats as the fallback for post stats when videos.list is out
 * of quota (plan §13 B), with its own quota counted per Pacific day. Only
 * fetch and the database are mocked.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const queryRaw = jest.fn();
const executeRaw = jest.fn();
const findUnique = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: (...a: unknown[]) => queryRaw(...a),
    $executeRawUnsafe: (...a: unknown[]) => executeRaw(...a),
    opsQuotaDay: { findUnique: (...a: unknown[]) => findUnique(...a) },
  },
}));

import { fetchYouTubeMetrics, fetchYouTubeMetricsBatch } from "@/lib/platforms/fetchPostMetrics";
import {
  BATCH_STATS_BUCKET,
  VIDEOS_LIST_BUCKET,
  fetchYouTubeBatchStats,
  isQuotaExceeded,
  resetYouTubeQuotaState,
} from "@/lib/platforms/youtubeBatchStats";
import { pacificDay, quotaAllows } from "@/lib/ops/quotaDay";
import { QUOTA_DDL } from "@/lib/ops/quotaSchemaDdl";
import { resetQuotaTablesCache } from "@/lib/ops/quotaTables";

const KEY = "fake-api-key";
const QUOTA_403 = JSON.stringify({
  error: { code: 403, errors: [{ domain: "youtube.quota", reason: "quotaExceeded" }] },
});

type Asked = { method: "list" | "batch"; ids: string[] };

function reply(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status < 400, status, json: async () => JSON.parse(text), text: async () => text };
}

const stat = (id: string, views = 1000) => ({
  kind: "youtube#videoStats",
  id,
  snippet: { publishTime: "2026-09-20T12:00:00Z" },
  statistics: { viewCount: String(views), likeCount: "50", commentCount: "5" },
});

/** videos.list answers per `list`, batchGetStats per `batch`; both record what they were asked. */
function fakeYouTube({
  list,
  batch = (ids: string[]) => reply(200, { items: ids.map((id) => stat(id)) }),
}: {
  list: (ids: string[]) => ReturnType<typeof reply>;
  batch?: (ids: string[]) => ReturnType<typeof reply>;
}) {
  const asked: Asked[] = [];
  global.fetch = jest.fn(async (input: string) => {
    const u = new URL(input);
    const ids = (u.searchParams.get("id") ?? "").split(",").filter(Boolean);
    if (u.pathname.endsWith("/videos:batchGetStats")) {
      asked.push({ method: "batch", ids });
      expect(u.searchParams.get("part")).toBe("statistics,snippet");
      return batch(ids);
    }
    asked.push({ method: "list", ids });
    return list(ids);
  }) as unknown as typeof fetch;
  return asked;
}

const realFetch = global.fetch;
const realUrl = process.env.DATABASE_URL;
let tableReady = false;

beforeEach(() => {
  jest.clearAllMocks();
  resetYouTubeQuotaState();
  resetQuotaTablesCache();
  tableReady = false;
  process.env.YOUTUBE_API_KEY = KEY;
  delete process.env.YOUTUBE_BATCH_STATS_DAILY_UNITS;
  delete process.env.DATABASE_URL;
  queryRaw.mockImplementation(async () => [{ n: tableReady ? 1 : 0 }]);
  executeRaw.mockResolvedValue(1);
  findUnique.mockResolvedValue(null);
});
afterAll(() => {
  global.fetch = realFetch;
  process.env.DATABASE_URL = realUrl;
});

const withTable = () => {
  process.env.DATABASE_URL = "postgres://test.invalid/db";
  tableReady = true;
};

describe("isQuotaExceeded", () => {
  it("is the 403 quotaExceeded answer and nothing else", () => {
    expect(isQuotaExceeded(403, QUOTA_403)).toBe(true);
    expect(isQuotaExceeded(403, JSON.stringify({ error: { errors: [{ reason: "dailyLimitExceeded" }] } }))).toBe(true);
    expect(isQuotaExceeded(403, JSON.stringify({ error: { errors: [{ reason: "forbidden" }] } }))).toBe(false);
    expect(isQuotaExceeded(400, QUOTA_403)).toBe(false);
    expect(isQuotaExceeded(403, "not json")).toBe(false);
  });
});

describe("pacificDay", () => {
  it("turns over at midnight Pacific, which is when YouTube resets quota", () => {
    expect(pacificDay(Date.parse("2026-10-02T06:59:00Z"))).toBe("2026-10-01");
    expect(pacificDay(Date.parse("2026-10-02T07:00:00Z"))).toBe("2026-10-02");
  });
});

describe("fetchYouTubeMetrics (one post)", () => {
  it("reads through batchGetStats when videos.list is out of quota, then skips videos.list", async () => {
    const asked = fakeYouTube({ list: () => reply(403, QUOTA_403) });

    const m = await fetchYouTubeMetrics("vidAAAAAAA1");
    expect(m).toMatchObject({ viewsCount: 1000, likesCount: 50, commentsCount: 5 });
    expect(m.postedAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
    expect(m.fetchReason).toBeUndefined();
    expect(asked).toEqual([
      { method: "list", ids: ["vidAAAAAAA1"] },
      { method: "batch", ids: ["vidAAAAAAA1"] },
    ]);

    asked.length = 0;
    await fetchYouTubeMetrics("vidAAAAAAA2");
    expect(asked).toEqual([{ method: "batch", ids: ["vidAAAAAAA2"] }]);
  });

  it("leaves a 403 that is not about quota as it was", async () => {
    const asked = fakeYouTube({ list: () => reply(403, { error: { errors: [{ reason: "forbidden" }] } }) });
    const m = await fetchYouTubeMetrics("vidAAAAAAA1");
    expect(m.fetchReason).toBe("platform-refused");
    expect(asked.map((a) => a.method)).toEqual(["list"]);
  });

  it("files a video the fallback did not return as unread, never deleted and never 0", async () => {
    fakeYouTube({ list: () => reply(403, QUOTA_403), batch: () => reply(200, { items: [], summary: { failedVideoCount: 1 } }) });
    const m = await fetchYouTubeMetrics("vidAAAAAAA1");
    expect(m.fetchReason).toBe("platform-refused");
    expect(m.viewsCount).toBeUndefined();
  });
});

describe("fetchYouTubeMetricsBatch (the cron)", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `vid${String(i).padStart(8, "0")}`);

  it("moves the chunks videos.list could not answer to batchGetStats, 50 ids a call", async () => {
    let listCalls = 0;
    const asked = fakeYouTube({
      list: (chunk) => {
        listCalls++;
        return listCalls === 1
          ? reply(200, { items: chunk.map((id) => ({ id, statistics: { viewCount: "7" }, snippet: {} })) })
          : reply(403, QUOTA_403);
      },
    });

    const out = await fetchYouTubeMetricsBatch(ids);

    expect(asked.filter((a) => a.method === "list")).toHaveLength(2);
    const batches = asked.filter((a) => a.method === "batch");
    expect(batches.map((b) => b.ids.length)).toEqual([50, 20]);
    expect(out.size).toBe(120);
    expect(out.get(ids[0])?.viewsCount).toBe(7);
    expect(out.get(ids[119])).toMatchObject({ viewsCount: 1000, likesCount: 50 });
  });

  it("enters what the fallback could not read as unread, not deleted", async () => {
    fakeYouTube({
      list: () => reply(403, QUOTA_403),
      batch: (chunk) => reply(200, { items: chunk.slice(1).map((id) => stat(id)) }),
    });
    const out = await fetchYouTubeMetricsBatch(ids.slice(0, 3));
    expect(out.get(ids[0])).toMatchObject({ fetchReason: "platform-refused" });
    expect(out.get(ids[0])?.viewsCount).toBeUndefined();
    expect(out.get(ids[1])?.viewsCount).toBe(1000);
  });

  it("keeps today's behaviour when videos.list fails for another reason", async () => {
    const asked = fakeYouTube({ list: () => reply(500, "backend error") });
    const out = await fetchYouTubeMetricsBatch(ids.slice(0, 3));
    expect(out.size).toBe(0);
    expect(asked.every((a) => a.method === "list")).toBe(true);
  });
});

describe("batchGetStats quota accounting", () => {
  it("counts one unit per call in its own bucket on the Pacific day", async () => {
    withTable();
    fakeYouTube({ list: () => reply(403, QUOTA_403) });
    const now = Date.parse("2026-10-02T03:00:00Z");

    await fetchYouTubeBatchStats(["vidAAAAAAA1", "vidAAAAAAA2"], KEY, { nowMs: now });

    const writes = executeRaw.mock.calls.filter((c) => String(c[0]).includes('"OpsQuotaDay"'));
    expect(writes).toHaveLength(1);
    expect(writes[0].slice(1)).toEqual(["2026-10-01", BATCH_STATS_BUCKET, 1, 1]);
    expect(String(writes[0][0])).toMatch(/"units", "calls"/);
  });

  it("records the day videos.list ran out, once", async () => {
    withTable();
    fakeYouTube({ list: () => reply(403, QUOTA_403) });
    await fetchYouTubeMetrics("vidAAAAAAA1");
    await fetchYouTubeMetrics("vidAAAAAAA2");
    const listWrites = executeRaw.mock.calls.filter((c) => c[2] === VIDEOS_LIST_BUCKET);
    expect(listWrites).toHaveLength(1);
    expect(String(listWrites[0][0])).toMatch(/"quotaErrors"/);
  });

  it("stops calling once the day's units are spent", async () => {
    withTable();
    process.env.YOUTUBE_BATCH_STATS_DAILY_UNITS = "5";
    findUnique.mockResolvedValue({ units: 5 });
    const asked = fakeYouTube({ list: () => reply(403, QUOTA_403) });

    const r = await fetchYouTubeBatchStats(["vidAAAAAAA1"], KEY);
    expect(r).toEqual({ items: new Map(), unread: ["vidAAAAAAA1"] });
    expect(asked).toEqual([]);
    expect(executeRaw.mock.calls.some((c) => String(c[0]).includes('"refused"'))).toBe(true);
  });

  it("stops asking for the day once batchGetStats itself is out of quota", async () => {
    const asked = fakeYouTube({ list: () => reply(403, QUOTA_403), batch: () => reply(403, QUOTA_403) });
    expect((await fetchYouTubeBatchStats(["vidAAAAAAA1"], KEY)).unread).toEqual(["vidAAAAAAA1"]);
    expect((await fetchYouTubeBatchStats(["vidAAAAAAA2"], KEY)).unread).toEqual(["vidAAAAAAA2"]);
    expect(asked.filter((a) => a.method === "batch")).toHaveLength(1);
  });

  it("calls, and counts nothing, while the table is absent", async () => {
    const asked = fakeYouTube({ list: () => reply(403, QUOTA_403) });
    const r = await fetchYouTubeBatchStats(["vidAAAAAAA1"], KEY);
    expect(r.items.size).toBe(1);
    expect(asked).toHaveLength(1);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("allows an unknown count and refuses at the cap", () => {
    expect(quotaAllows(null, 10)).toBe(true);
    expect(quotaAllows(9, 10)).toBe(true);
    expect(quotaAllows(10, 10)).toBe(false);
  });
});

describe("OpsQuotaDay DDL", () => {
  it("is idempotent and one statement per element", () => {
    for (const stmt of QUOTA_DDL) {
      expect(stmt).toMatch(/IF NOT EXISTS/);
      expect(stmt).not.toContain(";");
    }
  });
});
