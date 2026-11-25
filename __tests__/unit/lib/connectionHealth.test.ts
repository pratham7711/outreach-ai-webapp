/**
 * @jest-environment node
 *
 * Real expiry of a Facebook-Login connection: the 14-day "Reconnect soon" and
 * 3-day ops windows, the earlier of token expiry and data-access expiry, an
 * unknown expiry going to debug_token rather than being trusted, and the
 * Page token being stored only when Meta says it never expires.
 */
jest.mock("@/lib/db", () => ({
  db: { creatorConnectionHealth: { findMany: jest.fn(), upsert: jest.fn() } },
}));
jest.mock("@/lib/crypto/encrypt", () => ({
  decrypt: jest.fn((v: string) => `plain:${v}`),
  encrypt: jest.fn((v: string) => `enc:${v}`),
}));
jest.mock("@/lib/platforms/instagram", () => ({ listGrantedPages: jest.fn() }));
jest.mock("@/lib/platforms/metaDebugToken", () => ({ debugMetaToken: jest.fn() }));

import { db } from "@/lib/db";
import { listGrantedPages } from "@/lib/platforms/instagram";
import { debugMetaToken } from "@/lib/platforms/metaDebugToken";
import {
  assessMetaConnection,
  connectionHealthFor,
  decryptPageToken,
  earliestLapse,
  lapseStage,
  lapsingConnections,
  storePageToken,
} from "@/lib/platforms/connectionHealth";

const mockDb = db as unknown as { creatorConnectionHealth: { findMany: jest.Mock; upsert: jest.Mock } };
const mockDebug = debugMetaToken as jest.Mock;
const mockPages = listGrantedPages as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-12-01T00:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.creatorConnectionHealth.findMany.mockResolvedValue([]);
  mockDb.creatorConnectionHealth.upsert.mockResolvedValue({});
});

describe("lapseStage", () => {
  it("is ok with nothing known to lapse", () => {
    expect(lapseStage(null, NOW)).toBe("ok");
  });
  it("is ok beyond 14 days, soon inside 14, critical inside 3, lapsed once past", () => {
    expect(lapseStage(inDays(14.5), NOW)).toBe("ok");
    expect(lapseStage(inDays(14), NOW)).toBe("soon");
    expect(lapseStage(inDays(3.5), NOW)).toBe("soon");
    expect(lapseStage(inDays(3), NOW)).toBe("critical");
    expect(lapseStage(inDays(0.1), NOW)).toBe("critical");
    expect(lapseStage(inDays(0), NOW)).toBe("lapsed");
    expect(lapseStage(inDays(-2), NOW)).toBe("lapsed");
  });
});

describe("earliestLapse", () => {
  it("takes the earlier of token expiry and data-access expiry", () => {
    expect(earliestLapse(inDays(50), inDays(20))).toEqual(inDays(20));
    expect(earliestLapse(inDays(5), inDays(80))).toEqual(inDays(5));
  });
  it("uses whichever is known, and nothing when neither is", () => {
    expect(earliestLapse(null, inDays(9))).toEqual(inDays(9));
    expect(earliestLapse(inDays(9), null)).toEqual(inDays(9));
    expect(earliestLapse(null, null)).toBeNull();
  });
});

describe("reading health without the table", () => {
  it("answers 'nothing recorded' when the table is missing", async () => {
    mockDb.creatorConnectionHealth.findMany.mockRejectedValue(Object.assign(new Error("x"), { code: "P2021" }));
    expect((await connectionHealthFor(["a"])).size).toBe(0);
    expect((await lapsingConnections(["a"], NOW)).size).toBe(0);
  });
});

describe("lapsingConnections", () => {
  it("returns only connections inside the 14-day window or past it", async () => {
    mockDb.creatorConnectionHealth.findMany.mockResolvedValue([
      { accountId: "far", lapsesAt: inDays(40), tokenExpiresAt: null, dataAccessExpiresAt: null, checkedAt: null, pageId: null, pageAccessToken: null },
      { accountId: "near", lapsesAt: inDays(9), tokenExpiresAt: null, dataAccessExpiresAt: null, checkedAt: null, pageId: null, pageAccessToken: null },
      { accountId: "none", lapsesAt: null, tokenExpiresAt: null, dataAccessExpiresAt: null, checkedAt: null, pageId: null, pageAccessToken: null },
    ]);
    expect([...(await lapsingConnections(["far", "near", "none"], NOW)).keys()]).toEqual(["near"]);
  });
});

describe("decryptPageToken", () => {
  it("opens a stored Page token and returns undefined for none", () => {
    expect(decryptPageToken({ pageAccessToken: "sealed" }, "org")).toBe("plain:sealed");
    expect(decryptPageToken({ pageAccessToken: null }, "org")).toBeUndefined();
    expect(decryptPageToken(undefined, "org")).toBeUndefined();
  });
});

const IG_ROW = { id: "acct", platform: "INSTAGRAM", platformUserId: "ig-1" };
const FB_ROW = { id: "acct", platform: "FACEBOOK", platformUserId: "page-1" };

describe("storePageToken", () => {
  it("stores the Page linked to the Instagram account, sealed, when Meta says it never expires", async () => {
    mockPages.mockResolvedValue([
      { id: "page-0", access_token: "tok-0", instagram_business_account: { id: "ig-other" } },
      { id: "page-1", access_token: "tok-1", instagram_business_account: { id: "ig-1" } },
    ]);
    mockDebug.mockResolvedValue({ valid: true, expiresAt: null, dataAccessExpiresAt: null });
    expect(await storePageToken(IG_ROW, "user-tok", "org")).toBe("stored");
    expect(mockDebug).toHaveBeenCalledWith("tok-1");
    expect(mockDb.creatorConnectionHealth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { pageId: "page-1", pageAccessToken: "enc:tok-1" } }),
    );
  });

  it("matches a Facebook connection by Page id", async () => {
    mockPages.mockResolvedValue([{ id: "page-1", access_token: "tok-1" }]);
    mockDebug.mockResolvedValue({ valid: true, expiresAt: null, dataAccessExpiresAt: null });
    expect(await storePageToken(FB_ROW, "user-tok", "org")).toBe("stored");
  });

  it("does not store a Page token that Meta says expires (minted from a short-lived user token)", async () => {
    mockPages.mockResolvedValue([{ id: "page-1", access_token: "tok-1", instagram_business_account: { id: "ig-1" } }]);
    mockDebug.mockResolvedValue({ valid: true, expiresAt: inDays(1), dataAccessExpiresAt: null });
    expect(await storePageToken(IG_ROW, "user-tok", "org")).toBe("not-permanent");
    expect(mockDb.creatorConnectionHealth.upsert).not.toHaveBeenCalled();
  });

  it("does not store when debug_token cannot be read", async () => {
    mockPages.mockResolvedValue([{ id: "page-1", access_token: "tok-1", instagram_business_account: { id: "ig-1" } }]);
    mockDebug.mockResolvedValue(null);
    expect(await storePageToken(IG_ROW, "user-tok", "org")).toBe("not-permanent");
  });

  it("reports no Page when none links to the account, or the row has no account id", async () => {
    mockPages.mockResolvedValue([{ id: "page-0", access_token: "t", instagram_business_account: { id: "other" } }]);
    expect(await storePageToken(IG_ROW, "user-tok", "org")).toBe("no-page");
    expect(await storePageToken({ ...IG_ROW, platformUserId: null }, "user-tok", "org")).toBe("no-page");
  });

  it("never throws", async () => {
    mockPages.mockRejectedValue(new Error("boom"));
    expect(await storePageToken(IG_ROW, "user-tok", "org")).toBe("failed");
  });
});

describe("assessMetaConnection", () => {
  it("reads debug_token even when the stored expiry is unknown, and records both dates and the earliest", async () => {
    mockDebug.mockResolvedValueOnce({ valid: true, expiresAt: inDays(40), dataAccessExpiresAt: inDays(10) });
    mockPages.mockResolvedValue([]);
    const a = await assessMetaConnection(IG_ROW, "user-tok", "org", undefined, NOW);
    expect(mockDebug).toHaveBeenCalledWith("user-tok");
    expect(a.lapsesAt).toEqual(inDays(10));
    expect(a.stage).toBe("soon");
    expect(mockDb.creatorConnectionHealth.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { tokenExpiresAt: inDays(40), dataAccessExpiresAt: inDays(10), lapsesAt: inDays(10), checkedAt: NOW },
      }),
    );
  });

  it("is critical inside 3 days on data access alone, with a token that never expires", async () => {
    mockDebug.mockResolvedValueOnce({ valid: true, expiresAt: null, dataAccessExpiresAt: inDays(2) });
    mockPages.mockResolvedValue([]);
    const a = await assessMetaConnection(IG_ROW, "user-tok", "org", undefined, NOW);
    expect(a.stage).toBe("critical");
  });

  it("treats a token that never expires and has no data-access date as ok", async () => {
    mockDebug.mockResolvedValueOnce({ valid: true, expiresAt: null, dataAccessExpiresAt: null });
    mockPages.mockResolvedValue([]);
    expect((await assessMetaConnection(IG_ROW, "user-tok", "org", undefined, NOW)).stage).toBe("ok");
  });

  it("flags a token Meta calls invalid and records nothing", async () => {
    mockDebug.mockResolvedValueOnce({ valid: false, expiresAt: null, dataAccessExpiresAt: null });
    const a = await assessMetaConnection(IG_ROW, "user-tok", "org", undefined, NOW);
    expect(a.invalid).toBe(true);
    expect(mockDb.creatorConnectionHealth.upsert).not.toHaveBeenCalled();
  });

  it("when Meta cannot be asked, keeps the last known date instead of calling the row fine", async () => {
    mockDebug.mockResolvedValueOnce(null);
    const held = { tokenExpiresAt: null, dataAccessExpiresAt: null, lapsesAt: inDays(2), checkedAt: null, pageId: null, pageAccessToken: null };
    const a = await assessMetaConnection(IG_ROW, "user-tok", "org", held, NOW);
    expect(a.invalid).toBe(false);
    expect(a.stage).toBe("critical");
    expect(mockDb.creatorConnectionHealth.upsert).not.toHaveBeenCalled();
  });

  it("fetches the Page token only when none is held", async () => {
    mockDebug.mockResolvedValue({ valid: true, expiresAt: null, dataAccessExpiresAt: null });
    const held = { tokenExpiresAt: null, dataAccessExpiresAt: null, lapsesAt: null, checkedAt: null, pageId: "p", pageAccessToken: "sealed" };
    const a = await assessMetaConnection(IG_ROW, "user-tok", "org", held, NOW);
    expect(a.pageToken).toBe("already");
    expect(mockPages).not.toHaveBeenCalled();
  });
});
