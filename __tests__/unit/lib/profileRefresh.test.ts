/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  db: {
    creatorProfileLink: { findMany: jest.fn(), update: jest.fn() },
    creator: { update: jest.fn() },
  },
}));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/creators/avatarStore", () => ({ captureAvatarIfStale: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn() }));

import { db } from "@/lib/db";
import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import { captureAvatarIfStale } from "@/lib/creators/avatarStore";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { PROFILE_REFRESH_MS, refreshRosterProfiles } from "@/lib/creators/profileRefresh";

const mockDb = db as any;
const mockRead = readCreatorProfile as jest.Mock;
const mockCapture = captureAvatarIfStale as jest.Mock;
const NOW = Date.parse("2026-09-29T10:00:00Z");

const link = (over: Record<string, unknown> = {}) => ({
  id: "l1", creatorId: "c1", orgId: "org-1", platform: "TIKTOK", handle: "synthpage", isPrimary: true, ...over,
});
const profile = (over: Record<string, unknown> = {}) => ({
  ok: true,
  profile: { followersCount: 51000, postsCount: 80, avgViews: 9000, sampledPosts: 12, avatarUrl: "https://cdn.example/p.jpg", ...over },
});

beforeEach(() => {
  jest.clearAllMocks();
  (rosterTablesReady as jest.Mock).mockResolvedValue(true);
  mockCapture.mockResolvedValue(true);
});

describe("refreshRosterProfiles", () => {
  it("takes due accounts only, least recently read first", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([]);
    await refreshRosterProfiles({ nowMs: NOW, limit: 40 });
    const args = mockDb.creatorProfileLink.findMany.mock.calls[0][0];
    expect(args.where.OR).toEqual([{ refreshedAt: null }, { refreshedAt: { lt: new Date(NOW - PROFILE_REFRESH_MS) } }]);
    expect(args.where.creator).toEqual({ deletedAt: null });
    expect(args.orderBy[0]).toEqual({ refreshedAt: { sort: "asc", nulls: "first" } });
    expect(args.take).toBe(40);
  });

  it("writes the primary account's figures onto the creator and stores its picture", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue(profile());
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { followersCount: 51000, averageViews: 9000, refreshedAt: new Date(NOW), refreshError: null },
    });
    expect(mockDb.creator.update).toHaveBeenCalledWith({ where: { id: "c1", orgId: "org-1" }, data: { followersCount: 51000, averageViews: 9000 } });
    expect(mockCapture).toHaveBeenCalledWith({ id: "c1", orgId: "org-1" }, "https://cdn.example/p.jpg", NOW);
    expect(counts).toMatchObject({ considered: 1, refreshed: 1, avatars: 1, failed: 0 });
  });

  it("leaves the creator row alone for a secondary account, and keeps views a read did not measure", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ platform: "INSTAGRAM", isPrimary: false })]);
    mockRead.mockResolvedValue(profile({ sampledPosts: 0, avgViews: 0 }));
    await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update.mock.calls[0][0].data).toEqual({ followersCount: 51000, refreshedAt: new Date(NOW), refreshError: null });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("falls back to the sandbox for TikTok", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link()]);
    mockRead.mockResolvedValue({ ok: false, reason: "unreadable", detail: "login shell" });
    const remote = jest.fn().mockResolvedValue(profile());
    const counts = await refreshRosterProfiles({ nowMs: NOW, readTikTokProfileRemote: remote });
    expect(remote).toHaveBeenCalledWith("synthpage");
    expect(counts.refreshed).toBe(1);
  });

  it("stamps a failed read so it waits a day instead of blocking the queue", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link({ platform: "YOUTUBE" })]);
    mockRead.mockResolvedValue({ ok: false, reason: "no-such-account" });
    const counts = await refreshRosterProfiles({ nowMs: NOW });
    expect(mockDb.creatorProfileLink.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { refreshedAt: new Date(NOW), refreshError: "no-such-account" },
    });
    expect(mockDb.creator.update).not.toHaveBeenCalled();
    expect(counts).toMatchObject({ failed: 1, refreshed: 0 });
  });

  it("does nothing before the roster tables exist", async () => {
    (rosterTablesReady as jest.Mock).mockResolvedValue(false);
    expect(await refreshRosterProfiles({ nowMs: NOW })).toMatchObject({ considered: 0 });
    expect(mockDb.creatorProfileLink.findMany).not.toHaveBeenCalled();
  });

  it("stops at its deadline and counts the rest as skipped", async () => {
    mockDb.creatorProfileLink.findMany.mockResolvedValue([link(), link({ id: "l2" })]);
    mockRead.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return profile();
    });
    const counts = await refreshRosterProfiles({ nowMs: NOW, deadlineMs: 10 });
    expect(counts).toMatchObject({ considered: 1, skipped: 1 });
  });
});
