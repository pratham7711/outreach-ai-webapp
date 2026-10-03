/**
 * @jest-environment node
 *
 * Add creator for an org with its own Instagram account: the handle is read
 * through that account at once and the result says so. Every other org adds a
 * creator exactly as before, with no read at all.
 */
const mockOwn = jest.fn();
jest.mock("@/lib/platforms/instagramAgencyCredential", () => ({
  getAgencyDiscoveryCredential: (...args: unknown[]) => mockOwn(...args),
}));

const mockRead = jest.fn();
jest.mock("@/lib/platforms/creatorProfile", () => ({
  readCreatorProfile: (...args: unknown[]) => mockRead(...args),
}));

const mockCreatorUpdateMany = jest.fn();
const mockLinkCreateMany = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    creator: { updateMany: (...args: unknown[]) => mockCreatorUpdateMany(...args) },
    creatorProfileLink: { createMany: (...args: unknown[]) => mockLinkCreateMany(...args) },
  },
}));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn(async () => true) }));
jest.mock("@/lib/creators/accountIds", () => ({ recordPlatformAccountId: jest.fn(async () => true) }));
jest.mock("@/lib/creators/avatarStore", () => ({ captureLatestAvatar: jest.fn(async () => false) }));

import { lookupNewCreatorViaAgency, readThroughOwnAccount } from "@/lib/creators/agencyLookup";
import { SOURCE_PROFILE_READ, SOURCE_TRACKER_READ } from "@/lib/creators/figureTime";

const NOW = new Date("2026-10-04T10:00:00Z");
const CONNECTED = new Date("2026-10-01T00:00:00Z");
const OWN = { token: "t", igUserId: "ig-1", username: "agency.account", connectedAt: CONNECTED };

const profile = { followersCount: 5000, postsCount: 12, avgViews: 900, sampledPosts: 10, accountId: "ig-c" };

beforeEach(() => {
  mockOwn.mockReset().mockResolvedValue(OWN);
  mockRead.mockReset().mockResolvedValue({ ok: true, profile, via: { username: "agency.account" } });
  mockCreatorUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  mockLinkCreateMany.mockReset().mockResolvedValue({ count: 1 });
});

const input = { orgId: "org-1", creatorId: "c-1", platform: "INSTAGRAM", handle: "@new.creator", now: NOW };

describe("lookupNewCreatorViaAgency", () => {
  it("reads nothing for an org without its own account", async () => {
    mockOwn.mockResolvedValue(null);
    expect(await lookupNewCreatorViaAgency(input)).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockCreatorUpdateMany).not.toHaveBeenCalled();
  });

  it("reads nothing for a platform other than Instagram", async () => {
    expect(await lookupNewCreatorViaAgency({ ...input, platform: "TIKTOK" })).toBeNull();
    expect(mockOwn).not.toHaveBeenCalled();
  });

  it("reads through the org's account and lands the figures on the new creator", async () => {
    const out = await lookupNewCreatorViaAgency(input);

    expect(mockRead).toHaveBeenCalledWith("INSTAGRAM", "new.creator", { orgId: "org-1" });
    expect(out).toEqual({ ok: true, followersCount: 5000, postsCount: 12, avgViews: 900, via: { username: "agency.account" } });
    expect(mockCreatorUpdateMany).toHaveBeenCalledWith({
      where: { id: "c-1", orgId: "org-1" },
      data: { followersCount: 5000, averageViews: 900 },
    });
    expect(mockLinkCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      orgId: "org-1",
      platform: "INSTAGRAM",
      handle: "new.creator",
      isPrimary: true,
      followersCount: 5000,
      refreshedAt: NOW,
    });
  });

  it("keeps a figure typed into the form", async () => {
    await lookupNewCreatorViaAgency({ ...input, typedFollowers: 1234 });
    expect(mockCreatorUpdateMany.mock.calls[0][0].data).toEqual({ averageViews: 900 });
  });

  it("reports a failed read and writes nothing", async () => {
    mockRead.mockResolvedValue({ ok: false, reason: "not-a-professional-account" });
    expect(await lookupNewCreatorViaAgency(input)).toEqual({ ok: false, reason: "not-a-professional-account" });
    expect(mockCreatorUpdateMany).not.toHaveBeenCalled();
  });

  it("does not claim the org's account when the read fell back to the platform's", async () => {
    mockRead.mockResolvedValue({ ok: true, profile });
    expect(await lookupNewCreatorViaAgency(input)).toMatchObject({ ok: true, via: null });
  });
});

describe("readThroughOwnAccount", () => {
  const after = new Date("2026-10-03T00:00:00Z");
  const before = new Date("2026-09-30T00:00:00Z");

  it("labels a public Instagram read made since the account was connected", async () => {
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: after, source: SOURCE_PROFILE_READ })).toEqual({
      username: "agency.account",
    });
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: after, source: SOURCE_TRACKER_READ })).not.toBeNull();
  });

  it("does not label a read from before the connection, another source, or another platform", async () => {
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: before, source: SOURCE_PROFILE_READ })).toBeNull();
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: after, source: "CreatorCore import" })).toBeNull();
    expect(await readThroughOwnAccount("org-1", "TIKTOK", { at: after, source: SOURCE_PROFILE_READ })).toBeNull();
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: null, source: SOURCE_PROFILE_READ })).toBeNull();
  });

  it("does not label anything for an org without a working account", async () => {
    mockOwn.mockResolvedValue(null);
    expect(await readThroughOwnAccount("org-1", "INSTAGRAM", { at: after, source: SOURCE_PROFILE_READ })).toBeNull();
  });
});
