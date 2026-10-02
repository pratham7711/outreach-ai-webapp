/**
 * @jest-environment node
 *
 * CreatorGrant writes and reads (plan K4): every function asks the table
 * guard first and never throws.
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    creatorGrant: { updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  },
}));

jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { db } from "@/lib/db";
import { resetGrantTablesCache } from "@/lib/creators/grantTables";
import {
  GRANT_SOURCES,
  REVOKE_REASONS,
  grantedScopes,
  grantsForCreator,
  recordGrant,
  revokeGrantsForConnections,
} from "@/lib/creators/grants";
import { requestedScopes } from "@/lib/oauth/providers";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  $transaction: jest.Mock;
  creatorGrant: { updateMany: jest.Mock; create: jest.Mock; findMany: jest.Mock };
};

const input = {
  orgId: "org-a",
  creatorId: "creator-a",
  platform: "TIKTOK" as const,
  connectionId: "conn-a",
  platformAccountId: "open-id-fake",
  scopes: ["user.info.basic"],
  scopesSource: "provider" as const,
  source: GRANT_SOURCES.CONNECT_LINK,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetGrantTablesCache();
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
  mockDb.$transaction.mockImplementation(async (ops: unknown[]) => ops);
  mockDb.creatorGrant.updateMany.mockResolvedValue({ count: 0 });
  mockDb.creatorGrant.create.mockResolvedValue({ id: "grant-1" });
});

describe("grantedScopes", () => {
  it("takes what the provider said, split on commas (TikTok) or spaces (Google)", () => {
    expect(grantedScopes("tiktok", "user.info.basic,video.list")).toEqual({
      scopes: ["user.info.basic", "video.list"],
      scopesSource: "provider",
    });
    expect(grantedScopes("youtube", "openid https://www.googleapis.com/auth/youtube.readonly")).toEqual({
      scopes: ["openid", "https://www.googleapis.com/auth/youtube.readonly"],
      scopesSource: "provider",
    });
  });

  it("labels the app's own request as requested when the provider says nothing (Meta)", () => {
    expect(grantedScopes("instagram", undefined)).toEqual({
      scopes: requestedScopes("instagram"),
      scopesSource: "requested",
    });
    expect(grantedScopes("facebook", "  ")).toMatchObject({ scopesSource: "requested" });
  });
});

describe("recordGrant", () => {
  it("supersedes this org's live grant on the connection and creates the new one, in one transaction", async () => {
    expect(await recordGrant(input)).toBe(true);
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    expect(mockDb.creatorGrant.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org-a", connectionId: "conn-a", revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: REVOKE_REASONS.SUPERSEDED },
    });
    expect(mockDb.creatorGrant.create.mock.calls[0][0].data).toMatchObject({
      orgId: "org-a",
      creatorId: "creator-a",
      platform: "TIKTOK",
      connectionId: "conn-a",
      scopes: ["user.info.basic"],
      scopesSource: "provider",
      source: "connect-link",
    });
  });

  it("records nothing, and does not throw, while the table is absent", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await recordGrant(input)).toBe(false);
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("never fails the connection on a write error", async () => {
    mockDb.$transaction.mockRejectedValue(new Error("unique violation"));
    await expect(recordGrant(input)).resolves.toBe(false);
  });

  it("checks the table freshly, so a grant is not missed in the minute after it appears", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([{ n: 1 }]);
    expect(await recordGrant(input)).toBe(false);
    expect(await recordGrant(input)).toBe(true);
  });
});

describe("revokeGrantsForConnections", () => {
  it("ends every live grant on those connections with the reason, deleting nothing", async () => {
    mockDb.creatorGrant.updateMany.mockResolvedValue({ count: 2 });
    expect(await revokeGrantsForConnections(["conn-a", "conn-a", "conn-b"], REVOKE_REASONS.INVALID_GRANT)).toBe(2);
    expect(mockDb.creatorGrant.updateMany).toHaveBeenCalledWith({
      where: { connectionId: { in: ["conn-a", "conn-b"] }, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: "invalid_grant" },
    });
  });

  it("asks nothing for an empty list", async () => {
    expect(await revokeGrantsForConnections([], REVOKE_REASONS.DISCONNECT)).toBe(0);
    expect(mockDb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("is a no-op while the table is absent and never throws", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await revokeGrantsForConnections(["conn-a"], REVOKE_REASONS.DISCONNECT)).toBe(0);
    expect(mockDb.creatorGrant.updateMany).not.toHaveBeenCalled();

    resetGrantTablesCache();
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    mockDb.creatorGrant.updateMany.mockRejectedValue(new Error("boom"));
    await expect(revokeGrantsForConnections(["conn-a"], REVOKE_REASONS.DISCONNECT)).resolves.toBe(0);
  });
});

describe("grantsForCreator", () => {
  it("is null while the table is absent, so the panel can say so", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await grantsForCreator("org-a", "creator-a", [])).toBeNull();
  });

  it("asks for this org's grants only, by creator or by current connection", async () => {
    mockDb.creatorGrant.findMany.mockResolvedValue([]);
    await grantsForCreator("org-a", "creator-a", ["conn-a"]);
    expect(mockDb.creatorGrant.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-a",
      OR: [{ creatorId: "creator-a" }, { connectionId: { in: ["conn-a"] } }],
    });
  });
});
