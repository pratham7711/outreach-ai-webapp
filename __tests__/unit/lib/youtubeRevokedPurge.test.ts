/**
 * @jest-environment node
 *
 * YouTube API Services policy: a grant revoked from Google's own settings must
 * have its stored data deleted within 30 days. Google tells nobody; the daily
 * refresh marks the row "Reconnect needed" on invalid_grant, and this purge
 * disconnects rows still marked three weeks later.
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorAccountState: { findMany: jest.fn(), deleteMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/creators/connectTables", () => ({ connectTablesReady: jest.fn() }));
jest.mock("@/lib/portal/disconnect", () => ({ disconnectSocialAccount: jest.fn() }));
jest.mock("@/lib/creators/grants", () => ({ REVOKE_REASONS: { INVALID_GRANT: "invalid_grant" } }));

import { db } from "@/lib/db";
import { connectTablesReady } from "@/lib/creators/connectTables";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";
import {
  forgetRevokedYouTubeConnections,
  YOUTUBE_REVOKED_DELETE_AFTER_DAYS,
} from "@/lib/platforms/connectionRefresh";

const mockDb = db as unknown as {
  creatorAccountState: { findMany: jest.Mock; deleteMany: jest.Mock };
  creatorSocialAccount: { findMany: jest.Mock };
};
const mockReady = connectTablesReady as jest.Mock;
const mockDisconnect = disconnectSocialAccount as jest.Mock;

const NOW = new Date("2026-10-04T05:00:00Z");

function youtubeRow(id: string, orgId = "org-1") {
  return { id, creatorId: `cr-${id}`, platform: "YOUTUBE", accessToken: "enc", origin: "oauth", creator: { orgId } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReady.mockResolvedValue(true);
  mockDb.creatorAccountState.findMany.mockResolvedValue([{ accountId: "yt-1" }]);
  mockDb.creatorAccountState.deleteMany.mockResolvedValue({ count: 1 });
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([youtubeRow("yt-1")]);
  mockDisconnect.mockResolvedValue(undefined);
});

describe("forgetRevokedYouTubeConnections", () => {
  it("asks only for invalid_grant marks older than three weeks", async () => {
    await forgetRevokedYouTubeConnections(NOW);
    const where = mockDb.creatorAccountState.findMany.mock.calls[0][0].where;
    expect(YOUTUBE_REVOKED_DELETE_AFTER_DAYS).toBe(21);
    expect(where).toEqual({
      reconnectNeededAt: { lt: new Date("2026-09-13T05:00:00Z") },
      reconnectReason: "invalid_grant",
    });
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["yt-1"] },
      platform: "YOUTUBE",
    });
  });

  it("disconnects the way the creator's Disconnect does, without calling Google again", async () => {
    const n = await forgetRevokedYouTubeConnections(NOW);
    expect(n).toBe(1);
    expect(mockDisconnect).toHaveBeenCalledWith(
      { id: "yt-1", creatorId: "cr-yt-1", platform: "YOUTUBE", accessToken: "enc", origin: "oauth" },
      "org-1",
      { alreadyRevoked: true, revokeReason: "invalid_grant" },
    );
    expect(mockDb.creatorAccountState.deleteMany).toHaveBeenCalledWith({ where: { accountId: "yt-1" } });
  });

  it("touches nothing when no connection has been refused that long", async () => {
    mockDb.creatorAccountState.findMany.mockResolvedValue([]);
    expect(await forgetRevokedYouTubeConnections(NOW)).toBe(0);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
    expect(mockDisconnect).not.toHaveBeenCalled();
  });

  it("touches nothing before the connection tables exist", async () => {
    mockReady.mockResolvedValue(false);
    expect(await forgetRevokedYouTubeConnections(NOW)).toBe(0);
    expect(mockDb.creatorAccountState.findMany).not.toHaveBeenCalled();
  });

  it("carries on past a row that could not be removed, and counts only the ones that were", async () => {
    mockDb.creatorAccountState.findMany.mockResolvedValue([{ accountId: "yt-1" }, { accountId: "yt-2" }]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([youtubeRow("yt-1"), youtubeRow("yt-2", "org-2")]);
    mockDisconnect.mockRejectedValueOnce(new Error("db down"));
    expect(await forgetRevokedYouTubeConnections(NOW)).toBe(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(2);
    expect(mockDb.creatorAccountState.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockDb.creatorAccountState.deleteMany).toHaveBeenCalledWith({ where: { accountId: "yt-2" } });
  });
});
