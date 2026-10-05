/**
 * @jest-environment node
 *
 * Both ways a YouTube connection ends -- the creator's Disconnect and the
 * 21-day purge of a grant Google refused -- delete what the tracker read
 * through it, before the connection row, and a failure there keeps the row so
 * the disconnect is retried.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorSocialAccount: { delete: jest.fn(), count: jest.fn(), findMany: jest.fn() },
    creatorAccountState: { findMany: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock("@/lib/creators/forgetConnectedReadings", () => ({ forgetConnectedReadings: jest.fn() }));
jest.mock("@/lib/creators/grants", () => ({
  REVOKE_REASONS: { DISCONNECT: "disconnect", INVALID_GRANT: "invalid_grant" },
  revokeGrantsForConnections: jest.fn(),
}));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));
jest.mock("@/lib/crypto/encrypt", () => ({ decrypt: jest.fn(() => "plain-token"), encrypt: jest.fn() }));
jest.mock("@/lib/platforms/youtube", () => ({ revokeYouTubeToken: jest.fn() }));
jest.mock("@/lib/platforms/tiktokDisplay", () => ({ revokeTikTokToken: jest.fn() }));
jest.mock("@/lib/platforms/instagramAccount", () => ({ revokeInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/facebookPage", () => ({ revokeFacebookToken: jest.fn() }));

import { db } from "@/lib/db";
import { forgetConnectedReadings } from "@/lib/creators/forgetConnectedReadings";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { revokeYouTubeToken } from "@/lib/platforms/youtube";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";
import { forgetRevokedYouTubeConnections } from "@/lib/platforms/connectionRefresh";

const mockDb = db as any;
const mockForget = forgetConnectedReadings as jest.Mock;

const youtube = { id: "yt-1", creatorId: "cr-1", platform: "YOUTUBE", accessToken: "enc", origin: "oauth" };

beforeEach(() => {
  jest.clearAllMocks();
  mockForget.mockResolvedValue({ snapshots: 3, quarantined: 0 });
  mockDb.creatorSocialAccount.delete.mockResolvedValue({});
  mockDb.creatorSocialAccount.count.mockResolvedValue(0);
  (connectTablesReady as jest.Mock).mockResolvedValue(true);
});

describe("disconnectSocialAccount", () => {
  it("revokes at Google, then deletes the connected readings, then the row", async () => {
    await disconnectSocialAccount(youtube, "org-1");
    expect(revokeYouTubeToken).toHaveBeenCalledWith("plain-token");
    expect(mockForget).toHaveBeenCalledWith("cr-1", "YOUTUBE");
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "yt-1" } });
    expect(mockForget.mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.creatorSocialAccount.delete.mock.invocationCallOrder[0],
    );
  });

  it("does the same for any platform, scoped to the one disconnected", async () => {
    await disconnectSocialAccount({ ...youtube, id: "tt-1", platform: "TIKTOK" }, "org-1", { alreadyRevoked: true });
    expect(mockForget).toHaveBeenCalledWith("cr-1", "TIKTOK");
  });

  it("keeps the row when the readings could not be deleted, so the disconnect is retried", async () => {
    mockForget.mockRejectedValue(new Error("db down"));
    await expect(disconnectSocialAccount(youtube, "org-1")).rejects.toThrow("db down");
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
  });
});

describe("forgetRevokedYouTubeConnections", () => {
  beforeEach(() => {
    mockDb.creatorAccountState.findMany.mockResolvedValue([{ accountId: "yt-1" }]);
    mockDb.creatorAccountState.deleteMany.mockResolvedValue({ count: 1 });
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([{ ...youtube, creator: { orgId: "org-1" } }]);
  });

  it("deletes the readings taken through a grant Google refused three weeks ago", async () => {
    expect(await forgetRevokedYouTubeConnections(new Date("2026-10-04T05:00:00Z"))).toBe(1);
    expect(revokeYouTubeToken).not.toHaveBeenCalled();
    expect(mockForget).toHaveBeenCalledWith("cr-1", "YOUTUBE");
    expect(mockDb.creatorSocialAccount.delete).toHaveBeenCalledWith({ where: { id: "yt-1" } });
  });

  it("leaves the connection marked for tomorrow's pass when the readings could not be deleted", async () => {
    mockForget.mockRejectedValue(new Error("db down"));
    expect(await forgetRevokedYouTubeConnections(new Date("2026-10-04T05:00:00Z"))).toBe(0);
    expect(mockDb.creatorSocialAccount.delete).not.toHaveBeenCalled();
    expect(mockDb.creatorAccountState.deleteMany).not.toHaveBeenCalled();
  });
});
