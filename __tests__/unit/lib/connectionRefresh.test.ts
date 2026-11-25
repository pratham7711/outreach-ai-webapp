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
  db: { creatorSocialAccount: { findMany: jest.fn(), update: jest.fn() } },
}));
jest.mock("@/lib/platforms/connectionHealth", () => ({
  assessMetaConnection: jest.fn(),
  connectionHealthFor: jest.fn(),
}));
jest.mock("@/lib/platforms/accountState", () => ({
  accountStatesFor: jest.fn(),
  markReconnectNeeded: jest.fn(),
  recordDisplayName: jest.fn(),
}));
jest.mock("@/lib/platforms/accountSync", () => ({ refreshAccountIdentity: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({ ensureFreshInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/instagramLoginToken", () => ({ ensureFreshInstagramLoginToken: jest.fn() }));
jest.mock("@/lib/platforms/threadsToken", () => ({ ensureFreshThreadsToken: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ ensureFreshTikTokToken: jest.fn() }));
jest.mock("@/lib/platforms/youtubeToken", () => ({ ensureFreshYouTubeToken: jest.fn() }));

import { db } from "@/lib/db";
import { accountStatesFor, markReconnectNeeded, recordDisplayName } from "@/lib/platforms/accountState";
import { assessMetaConnection, connectionHealthFor } from "@/lib/platforms/connectionHealth";
import { refreshAccountIdentity } from "@/lib/platforms/accountSync";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { ensureFreshInstagramLoginToken } from "@/lib/platforms/instagramLoginToken";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { ensureFreshYouTubeToken } from "@/lib/platforms/youtubeToken";
import { oauthPlatformFor, refreshConnectedAccounts } from "@/lib/platforms/connectionRefresh";

const mockFindMany = (db as unknown as { creatorSocialAccount: { findMany: jest.Mock } })
  .creatorSocialAccount.findMany;
const mockUpdate = (db as unknown as { creatorSocialAccount: { update: jest.Mock } }).creatorSocialAccount.update;
const mockStates = accountStatesFor as jest.Mock;
const mockMark = markReconnectNeeded as jest.Mock;
const mockAssess = assessMetaConnection as jest.Mock;
const mockHealth = connectionHealthFor as jest.Mock;
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
  mockHealth.mockResolvedValue(new Map());
  mockMark.mockResolvedValue(true);
  mockAssess.mockResolvedValue({ facts: { valid: true, expiresAt: null, dataAccessExpiresAt: null }, invalid: false, lapsesAt: null, stage: "ok" });
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

describe("Meta connections: real expiry, never 'unknown means fine'", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const facts = (expiresAt: Date | null) => ({ valid: true, expiresAt, dataAccessExpiresAt: null });

  it("asks Meta about a Facebook-Login row whose tokenExpiry is null, and stores the answer", async () => {
    const expiresAt = new Date(Date.now() + 40 * DAY);
    mockFindMany.mockResolvedValue([row("ig-fb", "INSTAGRAM", "oauth")]);
    mockAssess.mockResolvedValue({ facts: facts(expiresAt), invalid: false, lapsesAt: expiresAt, stage: "ok" });
    await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockAssess).toHaveBeenCalledTimes(1);
    expect(mockAssess.mock.calls[0][1]).toBe("live-token");
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "ig-fb" }, data: { tokenExpiry: expiresAt } });
    /* the freshly learned date is handed to the token helper again, so a token
       inside its refresh window is exchanged on the same pass */
    expect(mockIg).toHaveBeenCalledTimes(2);
    expect(mockIg.mock.calls[1][0].tokenExpiry).toEqual(expiresAt);
  });

  it("does not call debug_token for TikTok, YouTube or Instagram Login rows", async () => {
    mockFindMany.mockResolvedValue([row("tt", "TIKTOK"), row("yt", "YOUTUBE"), row("igl", "INSTAGRAM", "oauth_instagram_login")]);
    await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockAssess).not.toHaveBeenCalled();
  });

  it("counts a connection inside 14 days as lapsing soon but only lists one inside 3 days for the ops alert", async () => {
    const in10 = new Date(Date.now() + 10 * DAY);
    const in2 = new Date(Date.now() + 2 * DAY);
    mockFindMany.mockResolvedValue([row("a", "INSTAGRAM", "oauth"), row("b", "FACEBOOK", "oauth")]);
    mockAssess
      .mockResolvedValueOnce({ facts: facts(in10), invalid: false, lapsesAt: in10, stage: "soon" })
      .mockResolvedValueOnce({ facts: facts(in2), invalid: false, lapsesAt: in2, stage: "critical" });
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER(), concurrency: 1 });
    expect(summary.lapsingSoon).toBe(2);
    expect(summary.lapsing).toEqual([{ accountId: "b", platform: "FACEBOOK", lapsesAt: in2.toISOString(), stage: "critical" }]);
    expect(mockMark).not.toHaveBeenCalled();
    expect(summary.refreshed).toBe(2);
  });

  it("marks a row Reconnect needed when Meta calls the token invalid, and does not read it", async () => {
    mockFindMany.mockResolvedValue([row("a", "INSTAGRAM", "oauth")]);
    mockAssess.mockResolvedValue({ facts: { valid: false, expiresAt: null, dataAccessExpiresAt: null }, invalid: true, lapsesAt: null, stage: "ok" });
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockMark).toHaveBeenCalledWith("a", "token_invalid");
    expect(summary.markedReconnect).toBe(1);
    expect(mockIdentity).not.toHaveBeenCalled();
  });

  it("marks a row Reconnect needed when its data access has already lapsed", async () => {
    const past = new Date(Date.now() - DAY);
    mockFindMany.mockResolvedValue([row("a", "FACEBOOK", "oauth")]);
    mockAssess.mockResolvedValue({ facts: { valid: true, expiresAt: null, dataAccessExpiresAt: past }, invalid: false, lapsesAt: past, stage: "lapsed" });
    await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockMark).toHaveBeenCalledWith("a", "token_expired");
  });

  it("marks a Meta row whose recorded token has expired even though no helper could return a token", async () => {
    mockFindMany.mockResolvedValue([{ ...row("a", "INSTAGRAM", "oauth"), tokenExpiry: new Date(Date.now() - DAY) }]);
    mockIg.mockResolvedValue(undefined);
    const summary = await refreshConnectedAccounts({ deadlineAt: LATER() });
    expect(mockMark).toHaveBeenCalledWith("a", "token_expired");
    expect(summary.noToken).toBe(1);
    expect(mockAssess).not.toHaveBeenCalled();
  });
});
