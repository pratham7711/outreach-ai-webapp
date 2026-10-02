/**
 * @jest-environment node
 *
 * The connection gate (plan K4): an org reads a creator's connection only
 * through a live grant of its own. Cross-org and revoked both answer
 * no_grant; with no grant table the gate answers what the readers' own query
 * answered before it existed, and says once that it is open.
 */
jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    creatorSocialAccount: { findFirst: jest.fn(), findMany: jest.fn() },
    creatorGrant: { findMany: jest.fn() },
  },
}));

const mockWarn = jest.fn();
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ warn: mockWarn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { db } from "@/lib/db";
import { resetGrantTablesCache } from "@/lib/creators/grantTables";
import {
  connectionForRead,
  grantedConnectionKeys,
  grantKey,
  NOT_MANUAL_ORIGIN,
  readableConnection,
  resetConnectionGateLog,
} from "@/lib/creators/connectionGate";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  creatorSocialAccount: { findFirst: jest.Mock; findMany: jest.Mock };
  creatorGrant: { findMany: jest.Mock };
};

type Row = { id: string; creatorId: string; orgId: string; platform: string; origin?: string | null };
type Grant = { id: string; orgId: string; connectionId: string; revokedAt: Date | null };

/* A two-org world. The same person is rostered in both; only org A's roster
   row holds the TikTok connection, and only org A holds a grant for it. */
let rows: Row[];
let grants: Grant[];

function connectionFields(r: Row) {
  return {
    id: r.id,
    creatorId: r.creatorId,
    platform: r.platform,
    handle: "fake_handle_a",
    origin: r.origin === undefined ? "oauth" : r.origin,
    accessToken: "enc:v1:sealed",
    refreshToken: null,
    tokenExpiry: null,
    platformUserId: "open-id-fake",
    followersCount: 10,
    statsSyncedAt: null,
  };
}

/** The where clause as Postgres would apply it, org filter and the manual-row
 *  exclusion included -- the latter only when the gate actually asked for it. */
function matchRows(where: { creatorId: string; platform: string; creator?: { orgId: string }; AND?: unknown[] }) {
  const excludesManual = Array.isArray(where.AND) && where.AND.includes(NOT_MANUAL_ORIGIN);
  return rows
    .filter((r) => r.creatorId === where.creatorId && r.platform === where.platform)
    .filter((r) => !where.creator || r.orgId === where.creator.orgId)
    .filter((r) => !excludesManual || r.origin !== "manual")
    .map(connectionFields);
}

function tableExists(yes: boolean) {
  mockDb.$queryRawUnsafe.mockResolvedValue([{ n: yes ? 1 : 0 }]);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetGrantTablesCache();
  resetConnectionGateLog();
  rows = [{ id: "conn-a", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK" }];
  grants = [{ id: "grant-a", orgId: "org-a", connectionId: "conn-a", revokedAt: null }];
  mockDb.creatorSocialAccount.findFirst.mockImplementation(async ({ where }) => matchRows(where)[0] ?? null);
  mockDb.creatorSocialAccount.findMany.mockImplementation(async ({ where }) => matchRows(where));
  mockDb.creatorGrant.findMany.mockImplementation(async ({ where }) =>
    grants
      .filter((g) => g.revokedAt === null)
      .filter((g) => {
        if (where.OR) {
          return where.OR.some(
            (c: { orgId: string; connectionId: { in: string[] } }) =>
              c.orgId === g.orgId && c.connectionId.in.includes(g.connectionId),
          );
        }
        return g.orgId === where.orgId && where.connectionId.in.includes(g.connectionId);
      })
      .map((g) => ({ id: g.id, orgId: g.orgId, connectionId: g.connectionId })),
  );
});

describe("connectionForRead, with the grant table", () => {
  beforeEach(() => tableExists(true));

  it("reads the connection for the org that holds the grant", async () => {
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: true, connection: expect.objectContaining({ id: "conn-a" }), grantId: "grant-a" });
  });

  it("answers no_grant to another org asking for the same creator", async () => {
    const read = await connectionForRead("org-b", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: false, unknown: "no_grant" });
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toMatchObject({
      creatorId: "creator-a",
      platform: "TIKTOK",
      creator: { orgId: "org-b" },
    });
  });

  it("answers no_grant cross-org even if the row lookup let the row through", async () => {
    /* The grant is the second, independent lock: a row query that forgot its
       org filter still finds no grant for org B. */
    mockDb.creatorSocialAccount.findMany.mockImplementation(async ({ where }) =>
      matchRows({ creatorId: where.creatorId, platform: where.platform }),
    );
    const read = await connectionForRead("org-b", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: false, unknown: "no_grant" });
    expect(mockDb.creatorGrant.findMany.mock.calls[0][0].where).toMatchObject({ orgId: "org-b", revokedAt: null });
  });

  it("answers no_grant once the grant is revoked, though the row is still there", async () => {
    grants[0].revokedAt = new Date();
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: false, unknown: "no_grant" });
  });

  it("answers no_grant for a hand-entered row that never had a consent", async () => {
    grants = [];
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: false, unknown: "no_grant" });
  });

  it("skips an ungranted row for a granted sibling on the same platform", async () => {
    rows = [
      { id: "conn-manual", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK" },
      { id: "conn-a", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK" },
    ];
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read.ok && read.connection.id).toBe("conn-a");
  });

  it("does not tell an org with no row anything different from one with no grant", async () => {
    const read = await connectionForRead("org-a", "creator-a", "YOUTUBE");
    expect(read).toEqual({ ok: false, unknown: "no_grant" });
  });

  it("passes a reader's filter and order through, under the org it names", async () => {
    await connectionForRead("org-a", "creator-a", "TIKTOK", { where: { origin: "oauth" }, order: "oldest" });
    const args = mockDb.creatorSocialAccount.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      AND: [{ origin: "oauth" }, NOT_MANUAL_ORIGIN],
      creatorId: "creator-a",
      platform: "TIKTOK",
      creator: { orgId: "org-a" },
    });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("does not let a filter override the creator, platform or org", async () => {
    await connectionForRead("org-a", "creator-a", "TIKTOK", {
      where: { creatorId: "creator-x", platform: "YOUTUBE", creator: { orgId: "org-x" } },
    });
    expect(mockDb.creatorSocialAccount.findMany.mock.calls[0][0].where).toMatchObject({
      creatorId: "creator-a",
      platform: "TIKTOK",
      creator: { orgId: "org-a" },
    });
  });
});

describe("connectionForRead, before the grant table exists", () => {
  beforeEach(() => tableExists(false));

  it("answers exactly what the reader's own query answered: the first matching row", async () => {
    grants = [];
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read).toEqual({ ok: true, connection: expect.objectContaining({ id: "conn-a" }), grantId: null });
    expect(mockDb.creatorSocialAccount.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.creatorGrant.findMany).not.toHaveBeenCalled();
  });

  it("answers no_connection when there is none", async () => {
    rows = [];
    expect(await connectionForRead("org-a", "creator-a", "TIKTOK")).toEqual({ ok: false, unknown: "no_connection" });
  });

  it("logs once per process that it is running ungated", async () => {
    await connectionForRead("org-a", "creator-a", "TIKTOK");
    await connectionForRead("org-a", "creator-a", "TIKTOK");
    await grantedConnectionKeys([{ orgId: "org-a", connectionId: "conn-a" }]);
    const ungated = mockWarn.mock.calls.filter(([m]) => String(m).includes("ungated"));
    expect(ungated).toHaveLength(1);
  });

  it("treats a failing table check as absent, not as a refusal", async () => {
    mockDb.$queryRawUnsafe.mockRejectedValue(new Error("db down"));
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read.ok).toBe(true);
  });

  /* Plan A8. With no grant to check, the query is the only lock: a typed-in
     row sitting first on the same platform used to be the "first matching
     row", and the reader then took a creator who had connected for one who
     had not. */
  it("never hands a reader a hand-entered row, even one ahead of the real connection", async () => {
    rows = [
      { id: "conn-manual", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK", origin: "manual" },
      { id: "conn-a", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK" },
    ];
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read.ok && read.connection.id).toBe("conn-a");
  });

  it("answers no_connection when the only row was typed in", async () => {
    rows = [{ id: "conn-manual", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK", origin: "manual" }];
    expect(await connectionForRead("org-a", "creator-a", "TIKTOK")).toEqual({ ok: false, unknown: "no_connection" });
  });

  it("still reads a row from before the origin column existed", async () => {
    rows = [{ id: "conn-legacy", creatorId: "creator-a", orgId: "org-a", platform: "TIKTOK", origin: null }];
    const read = await connectionForRead("org-a", "creator-a", "TIKTOK");
    expect(read.ok && read.connection.id).toBe("conn-legacy");
  });
});

describe("readableConnection (the bulk reader's per-row check)", () => {
  const granted = new Set([grantKey("org-a", "conn-a")]);

  it("refuses a hand-entered row while the gate is open", () => {
    expect(readableConnection(null, "org-a", { id: "conn-manual", origin: "manual" })).toBe(false);
  });

  it("refuses a hand-entered row even if a grant were on record for it", () => {
    expect(readableConnection(new Set([grantKey("org-a", "conn-manual")]), "org-a", { id: "conn-manual", origin: "manual" })).toBe(false);
  });

  it("uses every other row while the gate is open, as before", () => {
    expect(readableConnection(null, "org-a", { id: "conn-a", origin: "oauth" })).toBe(true);
    expect(readableConnection(null, "org-a", { id: "conn-old", origin: null })).toBe(true);
  });

  it("uses a row only for the org holding its grant once the gate is closed", () => {
    expect(readableConnection(granted, "org-a", { id: "conn-a", origin: "oauth" })).toBe(true);
    expect(readableConnection(granted, "org-b", { id: "conn-a", origin: "oauth" })).toBe(false);
  });
});

describe("grantedConnectionKeys (the bulk form, for the post sync cron)", () => {
  it("is null while the gate is open, so every row is used as before", async () => {
    tableExists(false);
    expect(await grantedConnectionKeys([{ orgId: "org-a", connectionId: "conn-a" }])).toBeNull();
  });

  it("answers only the (org, connection) pairs with a live grant", async () => {
    tableExists(true);
    const keys = await grantedConnectionKeys([
      { orgId: "org-a", connectionId: "conn-a" },
      { orgId: "org-b", connectionId: "conn-a" },
    ]);
    expect(keys).toEqual(new Set([grantKey("org-a", "conn-a")]));
  });

  it("fails closed when the lookup throws", async () => {
    tableExists(true);
    mockDb.creatorGrant.findMany.mockRejectedValue(new Error("boom"));
    expect(await grantedConnectionKeys([{ orgId: "org-a", connectionId: "conn-a" }])).toEqual(new Set());
  });
});
