/**
 * @jest-environment node
 *
 * The grant backfill (plan K4): one grant per real connection, for the org it
 * was made under, nothing for a row nobody consented to, and counts only in
 * what it reports.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    creatorSocialAccount: { findMany: jest.fn() },
    creatorGrant: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto/encrypt";
import { resetGrantTablesCache } from "@/lib/creators/grantTables";
import { grantKey } from "@/lib/creators/connectionGate";
import {
  applyBackfill,
  classifyForBackfill,
  loadBackfillPlan,
  planBackfill,
  publicPlan,
  type BackfillConnection,
} from "@/lib/creators/grantBackfill";

const mockDb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  creatorSocialAccount: { findMany: jest.Mock };
  creatorGrant: { findMany: jest.Mock; createMany: jest.Mock };
};

const CREATED = new Date("2026-05-01T00:00:00Z");

function conn(over: Partial<BackfillConnection> & { token?: string } = {}): BackfillConnection {
  const { token = "real-oauth-token-fake", ...rest } = over;
  const orgId = rest.orgId ?? "org-a";
  return {
    id: "conn-1",
    creatorId: "creator-1",
    platform: "TIKTOK",
    platformUserId: "open-id-fake",
    origin: "oauth",
    accessToken: encrypt(token, orgId),
    createdAt: CREATED,
    orgId,
    ...rest,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetGrantTablesCache();
});

describe("classifyForBackfill", () => {
  it("grants both OAuth origins", () => {
    expect(classifyForBackfill(conn({ origin: "oauth" }))).toBe("grant");
    expect(classifyForBackfill(conn({ origin: "oauth_instagram_login" }))).toBe("grant");
  });

  it("skips manual and dev rows by origin", () => {
    expect(classifyForBackfill(conn({ origin: "manual" }))).toBe("manual");
    expect(classifyForBackfill(conn({ origin: "dev" }))).toBe("dev");
  });

  it("tells a legacy NULL-origin row apart by its token, without returning it", () => {
    expect(classifyForBackfill(conn({ origin: null, token: "manual-entry" }))).toBe("manual");
    expect(classifyForBackfill(conn({ origin: null, token: "dev-token-tiktok-1" }))).toBe("dev");
    expect(classifyForBackfill(conn({ origin: null }))).toBe("grant");
  });

  it("does not grant a NULL-origin row whose token will not open under its org", () => {
    const sealedForAnotherOrg = encrypt("real-oauth-token-fake", "org-b");
    expect(classifyForBackfill(conn({ origin: null, accessToken: sealedForAnotherOrg }))).toBe("unreadable");
    expect(classifyForBackfill(conn({ origin: null, accessToken: "manual-entry" }))).toBe("unreadable");
  });

  it("does not grant a NULL-origin row with no platform identity (an agency-pasted token)", () => {
    expect(classifyForBackfill(conn({ origin: null, platformUserId: null }))).toBe("no_identity");
  });
});

describe("planBackfill", () => {
  it("plans one grant per real connection, under the org it hangs off, dated when it connected", () => {
    const plan = planBackfill(
      [
        conn({ id: "conn-1", orgId: "org-a" }),
        conn({ id: "conn-2", orgId: "org-b", platform: "YOUTUBE", creatorId: "creator-2" }),
        conn({ id: "conn-3", orgId: "org-a", origin: "manual" }),
      ],
      new Set(),
    );
    expect(plan.rows).toEqual([
      expect.objectContaining({ orgId: "org-a", connectionId: "conn-1", source: "backfill", grantedAt: CREATED, scopes: [], scopesSource: null }),
      expect.objectContaining({ orgId: "org-b", connectionId: "conn-2", platform: "YOUTUBE", creatorId: "creator-2" }),
    ]);
    expect(plan.counts).toEqual([
      { orgId: "org-a", platform: "TIKTOK", wouldCreate: 1, existing: 0, skipped: { manual: 1 } },
      { orgId: "org-b", platform: "YOUTUBE", wouldCreate: 1, existing: 0, skipped: {} },
    ]);
    expect(plan.totals).toEqual({ connections: 3, wouldCreate: 2, existing: 0, skipped: 1 });
  });

  it("leaves a connection that already holds a live grant in its own org", () => {
    const plan = planBackfill([conn({ id: "conn-1", orgId: "org-a" })], new Set([grantKey("org-a", "conn-1")]));
    expect(plan.rows).toEqual([]);
    expect(plan.counts[0]).toMatchObject({ existing: 1, wouldCreate: 0 });
  });

  it("does not count another org's grant as this connection's", () => {
    const plan = planBackfill([conn({ id: "conn-1", orgId: "org-a" })], new Set([grantKey("org-b", "conn-1")]));
    expect(plan.rows).toHaveLength(1);
  });

  it("reports counts only: no handle, token or connection id in what the routes return", () => {
    const plan = planBackfill([conn({ id: "conn-secret-id", token: "tok-fake-secret" })], new Set());
    const out = JSON.stringify(publicPlan(plan));
    expect(out).not.toContain("conn-secret-id");
    expect(out).not.toContain("tok-fake-secret");
    expect(out).not.toContain("enc:v1");
    expect(out).not.toContain("open-id-fake");
  });
});

describe("loadBackfillPlan / applyBackfill", () => {
  const rows = () => [
    {
      id: "conn-1",
      creatorId: "creator-1",
      platform: "TIKTOK",
      platformUserId: "open-id-fake",
      origin: "oauth",
      accessToken: "enc",
      createdAt: CREATED,
      creator: { orgId: "org-a" },
    },
  ];

  it("plans before the table exists without asking it anything", async () => {
    mockDb.creatorSocialAccount.findMany.mockResolvedValue(rows());
    const plan = await loadBackfillPlan(false);
    expect(plan.totals.wouldCreate).toBe(1);
    expect(mockDb.creatorGrant.findMany).not.toHaveBeenCalled();
  });

  it("refuses to apply while the table is absent", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await applyBackfill()).toBeNull();
    expect(mockDb.creatorGrant.createMany).not.toHaveBeenCalled();
  });

  it("writes only what is missing, and skips duplicates a callback raced in", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      ...rows(),
      { ...rows()[0], id: "conn-2", creatorId: "creator-2" },
    ]);
    mockDb.creatorGrant.findMany.mockResolvedValue([{ orgId: "org-a", connectionId: "conn-2" }]);
    mockDb.creatorGrant.createMany.mockResolvedValue({ count: 1 });

    const result = await applyBackfill();

    expect(result?.created).toBe(1);
    const args = mockDb.creatorGrant.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data.map((r: { connectionId: string }) => r.connectionId)).toEqual(["conn-1"]);
  });
});
