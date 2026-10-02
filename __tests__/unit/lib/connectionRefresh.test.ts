/**
 * @jest-environment node
 *
 * The daily pass over creators' own connections (cron/refresh-platform-tokens).
 * Pinned: each row is refreshed through its own flow's helper (an Instagram
 * Login row at graph.instagram.com, not graph.facebook.com), a "Reconnect
 * needed" row is left alone, a token that now names another account writes
 * nothing, and the time budget is honoured.
 */
jest.mock("@/lib/db", () => ({
  db: { creatorSocialAccount: { findMany: jest.fn() } },
}));
jest.mock("@/lib/platforms/accountState", () => ({
  accountStatesFor: jest.fn(),
  recordDisplayName: jest.fn(),
}));
jest.mock("@/lib/platforms/accountSync", () => ({ refreshAccountIdentity: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({ ensureFreshInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/instagramLoginToken", () => ({ ensureFreshInstagramLoginToken: jest.fn() }));
jest.mock("@/lib/platforms/threadsToken", () => ({ ensureFreshThreadsToken: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ ensureFreshTikTokToken: jest.fn() }));
jest.mock("@/lib/platforms/youtubeToken", () => ({ ensureFreshYouTubeToken: jest.fn() }));

import { db } from "@/lib/db";
import { accountStatesFor, recordDisplayName } from "@/lib/platforms/accountState";
import { refreshAccountIdentity } from "@/lib/platforms/accountSync";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { ensureFreshInstagramLoginToken } from "@/lib/platforms/instagramLoginToken";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { ensureFreshYouTubeToken } from "@/lib/platforms/youtubeToken";
import { oauthPlatformFor, refreshConnectedAccounts } from "@/lib/platforms/connectionRefresh";

const mockFindMany = (db as unknown as { creatorSocialAccount: { findMany: jest.Mock } })
  .creatorSocialAccount.findMany;
const mockStates = accountStatesFor as jest.Mock;
const mockDisplayName = recordDisplayName as jest.Mock;
const mockIdentity = refreshAccountIdentity as jest.Mock;
const mockIg = ensureFreshInstagramToken as jest.Mock;
const mockIgLogin = ensureFreshInstagramLoginToken as jest.Mock;
const mockTikTok = ensureFreshTikTokToken as jest.Mock;
const mockYouTube = ensureFreshYouTubeToken as jest.Mock;

function row(id: string, platform: string, origin: string | null = "oauth") {
  return {
    id,
    platform,
    origin,
    accessToken: "enc",
    refreshToken: null,
    tokenExpiry: null,
    platformUserId: `pu-${id}`,
    creator: { orgId: "org-1" },
  };
}

const LATER = () => Date.now() + 60_000;

beforeEach(() => {
  jest.clearAllMocks();
  mockStates.mockResolvedValue(new Map());
  for (const m of [mockIg, mockIgLogin, mockTikTok, mockYouTube]) m.mockResolvedValue("live-token");
  mockIdentity.mockResolvedValue({ platformUserId: "x", handle: "fake" });
});

describe("oauthPlatformFor", () => {
  it("tells the two Instagram flows apart by origin", () => {
    expect(oauthPlatformFor("INSTAGRAM", "oauth_instagram_login")).toBe("instagram-login");
    expect(oauthPlatformFor("INSTAGRAM", "oauth")).toBe("instagram");
    expect(oauthPlatformFor("INSTAGRAM", null)).toBe("instagram");
    expect(oauthPlatformFor("SNAPCHAT", "oauth")).toBeNull();
  });
});

describe("refreshConnectedAccounts", () => {
  it("selects only rows holding a real credential, stalest first", async () => {
    mockFindMany.mockResolvedValue([]);
    await refreshConnectedAccounts({ deadlineAt: LATER() });
    const args = mockFindMany.mock.calls[0][0];
    expect(args.where.accessToken).toEqual({ not: "manual-entry" });
    expect(args.where.creator).toEqual({ deletedAt: null });
    expect(args.where.OR).toEqual([
      { origin: null },
      { origin: { in: ["oauth", "oauth_instagram_login"] } },
    ]);
    expect(args.orderBy[0]).toEqual({ statsSyncedAt: { sort: "asc", nulls: "first" } });
  });

  it("refreshes each row through its own flow and re-reads it against its own id", async () => {
    mockFindMany.mockResolvedValue([
      row("ig-login", "INSTAGRAM", "oauth_instagram_login"),
      row("ig-fb", "INSTAGRAM", "oauth"),
      row("tt", "TIKTOK"),
    ]);
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER(), concurrency: 1 });

    expect(summary).toMatchObject({ considered: 3, refreshed: 3 });
    expect(mockIgLogin).toHaveBeenCalledTimes(1);
    expect(mockIgLogin.mock.calls[0][0].id).toBe("ig-login");
    expect(mockIg).toHaveBeenCalledTimes(1);
    expect(mockIg.mock.calls[0][0].id).toBe("ig-fb");
    expect(mockIdentity).toHaveBeenCalledWith("instagram-login", "INSTAGRAM", "ig-login", "live-token", "pu-ig-login");
    expect(mockIdentity).toHaveBeenCalledWith("tiktok", "TIKTOK", "tt", "live-token", "pu-tt");
  });

  it("stores TikTok's display_name when the read carries one", async () => {
    mockFindMany.mockResolvedValue([row("tt", "TIKTOK")]);
    mockIdentity.mockResolvedValue({ platformUserId: "pu-tt", displayName: "Fake Name" });
    await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockDisplayName).toHaveBeenCalledWith("tt", "Fake Name");
  });

  it("leaves a Reconnect-needed row alone: no token call, no read", async () => {
    mockFindMany.mockResolvedValue([row("yt", "YOUTUBE")]);
    mockStates.mockResolvedValue(new Map([["yt", { reconnectNeededAt: new Date() }]]));
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(summary.skippedReconnect).toBe(1);
    expect(mockYouTube).not.toHaveBeenCalled();
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it("counts a row with no usable token without reading it", async () => {
    mockFindMany.mockResolvedValue([row("yt", "YOUTUBE")]);
    mockYouTube.mockResolvedValue(undefined);
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(summary.noToken).toBe(1);
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it("counts a read that came back empty, or for another account, as a failure", async () => {
    mockFindMany.mockResolvedValue([row("tt", "TIKTOK")]);
    mockIdentity.mockResolvedValue(null);
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(summary).toMatchObject({ refreshed: 0, identityFailed: 1 });
    expect(mockDisplayName).not.toHaveBeenCalled();
  });

  it("keeps going past a row that throws", async () => {
    mockFindMany.mockResolvedValue([row("a", "TIKTOK"), row("b", "TIKTOK")]);
    mockTikTok.mockRejectedValueOnce(new Error("write failed")).mockResolvedValue("live-token");
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER(), concurrency: 1 });
    expect(summary).toMatchObject({ refreshed: 1, identityFailed: 1 });
  });

  it("starts no row once the deadline has passed, and says how many it left", async () => {
    mockFindMany.mockResolvedValue([row("a", "TIKTOK"), row("b", "TIKTOK"), row("c", "TIKTOK")]);
    const summary = await refreshConnectedAccounts({ deadlineAt: Date.now() - 1 });
    expect(summary).toMatchObject({ considered: 3, refreshed: 0, deferred: 3 });
    expect(mockTikTok).not.toHaveBeenCalled();
  });
});
