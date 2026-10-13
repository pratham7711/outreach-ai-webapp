/**
 * @jest-environment node
 *
 * The org-wide read cache serves a stored result only under a key that names
 * the org, the request and the org's data as it stands right now.
 */

const store = new Map<string, unknown>();
const unstableCache = jest.fn(
  (fn: () => Promise<unknown>, keyParts: string[], _opts?: unknown) => async () => {
    const key = JSON.stringify(keyParts);
    if (!store.has(key)) store.set(key, await fn());
    return store.get(key);
  },
);
jest.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], opts: unknown) => unstableCache(fn, keyParts, opts),
}));

jest.mock("@/lib/db", () => ({ db: { $queryRaw: jest.fn() } }));

import { cachedOrgRead, orgDataStamp, utcHourKey } from "@/lib/reports/orgReadCache";
import { db } from "@/lib/db";

const queryRaw = (db as unknown as { $queryRaw: jest.Mock }).$queryRaw;

const stampRow = (posts: string) => [{ posts, campaigns: "3:10", creators: "5:20", activations: null, views: null }];

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("cachedOrgRead", () => {
  it("serves the stored result while the org's data has not moved", async () => {
    queryRaw.mockResolvedValue(stampRow("7:100"));
    const compute = jest.fn().mockResolvedValue({ views: 1 });

    expect(await cachedOrgRead("r", "org-a", ["p"], {}, compute)).toEqual({ views: 1 });
    expect(await cachedOrgRead("r", "org-a", ["p"], {}, compute)).toEqual({ views: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("computes again as soon as the data moves", async () => {
    const compute = jest.fn().mockResolvedValueOnce({ views: 1 }).mockResolvedValueOnce({ views: 2 });

    queryRaw.mockResolvedValueOnce(stampRow("7:100"));
    expect(await cachedOrgRead("r", "org-a", ["p"], {}, compute)).toEqual({ views: 1 });
    queryRaw.mockResolvedValueOnce(stampRow("7:160"));
    expect(await cachedOrgRead("r", "org-a", ["p"], {}, compute)).toEqual({ views: 2 });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("never hands one org another org's entry, or one request another request's", async () => {
    queryRaw.mockResolvedValue(stampRow("7:100"));
    const compute = jest.fn().mockResolvedValue({});

    await cachedOrgRead("r", "org-a", ["UTC"], {}, compute);
    await cachedOrgRead("r", "org-b", ["UTC"], {}, compute);
    await cachedOrgRead("r", "org-a", ["Asia/Kolkata"], {}, compute);
    await cachedOrgRead("other", "org-a", ["UTC"], {}, compute);
    expect(compute).toHaveBeenCalledTimes(4);

    const [, keyParts, opts] = unstableCache.mock.calls[0];
    expect(keyParts).toEqual(expect.arrayContaining(["r", "org-a", "UTC"]));
    expect(keyParts[keyParts.length - 1]).toContain("7:100");
    expect(opts).toMatchObject({ tags: ["r:org-a"] });
  });

  it("never caches a read that names no org", async () => {
    const compute = jest.fn().mockResolvedValue({});
    await cachedOrgRead("r", "", [], {}, compute);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(unstableCache).not.toHaveBeenCalled();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("computes without the cache when the stamp cannot be read", async () => {
    queryRaw.mockRejectedValue(new Error("connection reset"));
    const compute = jest.fn().mockResolvedValue({ views: 3 });

    expect(await cachedOrgRead("r", "org-a", [], {}, compute)).toEqual({ views: 3 });
    expect(unstableCache).not.toHaveBeenCalled();
  });

  it("computes when there is no incremental cache, and surfaces any other cache error", async () => {
    queryRaw.mockResolvedValue(stampRow("7:100"));
    const compute = jest.fn().mockResolvedValue({ views: 4 });

    unstableCache.mockImplementationOnce(() => async () => {
      throw new Error("Invariant: incrementalCache missing in unstable_cache");
    });
    expect(await cachedOrgRead("r", "org-a", [], {}, compute)).toEqual({ views: 4 });

    unstableCache.mockImplementationOnce(() => async () => {
      throw new Error("relation does not exist");
    });
    await expect(cachedOrgRead("r", "org-a", [], {}, compute)).rejects.toThrow("relation does not exist");
  });
});

describe("orgDataStamp", () => {
  it("reads activations and daily views only for a read that depends on them", async () => {
    queryRaw.mockResolvedValue(stampRow("7:100"));
    expect(await orgDataStamp("org-a")).toBe("7:100|3:10|5:20|-|-");
    const bound = queryRaw.mock.calls[0].slice(1);
    expect(bound.filter((v: unknown) => typeof v === "boolean")).toEqual([false, false]);

    queryRaw.mockResolvedValue([{ posts: "7:100", campaigns: "3:10", creators: "5:20", activations: "9:1", views: "30:2" }]);
    expect(await orgDataStamp("org-a", { activations: true, viewsSnapshots: true })).toBe("7:100|3:10|5:20|9:1|30:2");
    expect(queryRaw.mock.calls[1].slice(1).filter((v: unknown) => typeof v === "boolean")).toEqual([true, true]);
  });

  it("scopes every count to the org it was asked about", async () => {
    queryRaw.mockResolvedValue(stampRow("0:"));
    await orgDataStamp("org-a", { activations: true, viewsSnapshots: true });
    const [strings, ...bound] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join("?");
    for (const table of ['"Post"', '"Campaign"', '"Creator"', '"Activation"', '"OrgViewsSnapshot"']) {
      expect(sql).toContain(table);
    }
    expect(bound.filter((v: unknown) => v === "org-a")).toHaveLength(5);
  });

  /* updatedAt moves on writes no figure depends on -- a failed read's note, a
     sweep's lastRefreshAt, a tracker's attempt stamp -- and every one of them
     emptied the org's cache. The stamp reads the columns the reads use. */
  it("keys on the columns the reads use, not on updatedAt", async () => {
    queryRaw.mockResolvedValue(stampRow("0:"));
    await orgDataStamp("org-a", { activations: true, viewsSnapshots: true });
    const sql = (queryRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).not.toContain("updatedAt");
    for (const column of [
      '"viewsCount"', '"likesCount"', '"commentsCount"', '"sharesCount"', '"savesCount"',
      '"lastSyncedAt"', '"postedAt"', '"creatorId"', '"campaignId"', '"postUrl"',
      "title", "status", '"createdAt"', '"deletedAt"', "handle", '"avatarUrl"', '"followersCount"',
      "day", '"postsCount"',
    ]) {
      expect(sql).toContain(column);
    }
  });
});

describe("utcHourKey", () => {
  it("is the same for every minute of one UTC hour and changes at the next", () => {
    expect(utcHourKey(new Date("2026-10-03T10:05:00Z"))).toBe(utcHourKey(new Date("2026-10-03T10:59:59Z")));
    expect(utcHourKey(new Date("2026-10-03T10:59:59Z"))).not.toBe(utcHourKey(new Date("2026-10-03T11:00:00Z")));
  });
});
