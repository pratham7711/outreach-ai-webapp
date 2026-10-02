/**
 * @jest-environment node
 *
 * Plan §13 A4: TikTok and Instagram account ids kept beside the handle, in a
 * new sidecar table, captured from reads the app already makes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    creatorPlatformAccountId: { upsert: jest.fn() },
  },
}));

import { ACCOUNT_ID_TABLES, CREATOR_ACCOUNT_ID_DDL } from "@/lib/creators/accountIdSchemaDdl";
import { accountIdTablesReady, resetAccountIdTablesCache } from "@/lib/creators/accountIdTables";
import { recordPlatformAccountId } from "@/lib/creators/accountIds";
import { GET, POST } from "@/app/api/admin/migrate-creator-account-ids/route";
import { parseTikTokProfileHtml } from "@/lib/platforms/tiktokProfile";
import { parseBusinessDiscovery } from "@/lib/platforms/instagramBusinessDiscovery";
import { db } from "@/lib/db";

const mdb = db as unknown as {
  $queryRawUnsafe: jest.Mock;
  $executeRawUnsafe: jest.Mock;
  creatorPlatformAccountId: { upsert: jest.Mock };
};

describe("account-id schema DDL", () => {
  it("runs every statement idempotently", () => {
    for (const stmt of CREATOR_ACCOUNT_ID_DDL) expect(stmt).toMatch(/IF (NOT )?EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    for (const stmt of CREATOR_ACCOUNT_ID_DDL) {
      expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
    }
  });

  it("creates only the new table, and adds no column to an existing one", () => {
    const created = CREATOR_ACCOUNT_ID_DDL.map((s) => /CREATE TABLE IF NOT EXISTS "([^"]+)"/.exec(s)?.[1]).filter(Boolean);
    expect(created).toEqual([...ACCOUNT_ID_TABLES]);
    for (const stmt of CREATOR_ACCOUNT_ID_DDL) expect(stmt).not.toMatch(/ADD COLUMN/i);
  });

  it("keeps every identifier inside Postgres's 63-character limit", () => {
    for (const stmt of CREATOR_ACCOUNT_ID_DDL) {
      for (const [, name] of stmt.matchAll(/"([^"]+)"/g)) expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261003090000_creator_account_ids/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of CREATOR_ACCOUNT_ID_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });
});

describe("accountIdTablesReady", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAccountIdTablesCache();
  });

  it("is true once the table exists, and then stops asking", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    expect(await accountIdTablesReady()).toBe(true);
    expect(await accountIdTablesReady()).toBe(true);
    expect(mdb.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("reads false while the table is missing or the lookup throws", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await accountIdTablesReady()).toBe(false);
    resetAccountIdTablesCache();
    mdb.$queryRawUnsafe.mockRejectedValue(new Error("down"));
    expect(await accountIdTablesReady()).toBe(false);
  });
});

describe("/api/admin/migrate-creator-account-ids", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-creator-account-ids", {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const saved = process.env.ADMIN_MIGRATE_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
  });
  afterAll(() => {
    process.env.ADMIN_MIGRATE_TOKEN = saved;
  });

  it("does not exist without ADMIN_MIGRATE_TOKEN, and refuses a wrong token", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(req("GET", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing table without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingTables: ["CreatorPlatformAccountId"] });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce([{ table_name: "CreatorPlatformAccountId" }]);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(CREATOR_ACCOUNT_ID_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingTables: [] });
  });
});

describe("recordPlatformAccountId", () => {
  const sighting = {
    creatorId: "cr-1",
    orgId: "org-1",
    platform: "TIKTOK",
    handle: "@fake.creator",
    profile: { accountId: "6900000000000000001", secUid: "MS4wLjABAAAAfakeSecUidForTests" },
    source: "tracker",
    now: new Date("2026-10-02T12:00:00Z"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetAccountIdTablesCache();
  });

  it("upserts on (creator, platform, id) and moves lastSeenAt and the handle on", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    mdb.creatorPlatformAccountId.upsert.mockResolvedValue({});
    expect(await recordPlatformAccountId(sighting)).toBe(true);
    const arg = mdb.creatorPlatformAccountId.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      creatorId_platform_platformAccountId: { creatorId: "cr-1", platform: "TIKTOK", platformAccountId: "6900000000000000001" },
    });
    expect(arg.create).toMatchObject({ orgId: "org-1", handle: "fake.creator", source: "tracker", firstSeenAt: sighting.now, lastSeenAt: sighting.now });
    expect(arg.update).toEqual({ lastSeenAt: sighting.now, source: "tracker", handle: "fake.creator", secUid: "MS4wLjABAAAAfakeSecUidForTests" });
  });

  it("writes nothing while the table is absent", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await recordPlatformAccountId(sighting)).toBe(false);
    expect(mdb.creatorPlatformAccountId.upsert).not.toHaveBeenCalled();
  });

  it("never throws into the read path", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    mdb.creatorPlatformAccountId.upsert.mockRejectedValue(new Error("unique violation"));
    await expect(recordPlatformAccountId(sighting)).resolves.toBe(false);
  });

  it("keeps only TikTok and Instagram, and only with an id", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    expect(await recordPlatformAccountId({ ...sighting, platform: "YOUTUBE" })).toBe(false);
    expect(await recordPlatformAccountId({ ...sighting, profile: {} })).toBe(false);
    expect(mdb.creatorPlatformAccountId.upsert).not.toHaveBeenCalled();
  });
});

describe("the readers carry the ids they already receive", () => {
  const tiktokPage = (user: Record<string, unknown>) =>
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.user-detail": {
          userInfo: { user, stats: { followerCount: 1200, videoCount: 30 } },
        },
      },
    })}</script>`;

  it("TikTok: user.id and secUid from the profile page", () => {
    const res = parseTikTokProfileHtml(tiktokPage({ id: "6900000000000000001", secUid: "MS4wLjABAAAAfakeSecUidForTests" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.profile.accountId).toBe("6900000000000000001");
      expect(res.profile.secUid).toBe("MS4wLjABAAAAfakeSecUidForTests");
      expect(res.profile.followersCount).toBe(1200);
    }
  });

  it("TikTok: no id when the page does not carry a plausible one", () => {
    const res = parseTikTokProfileHtml(tiktokPage({ id: "not-a-number" }));
    expect(res.ok && res.profile.accountId).toBeFalsy();
  });

  it("Instagram: the Business Discovery id from the same response", () => {
    const profile = parseBusinessDiscovery({ business_discovery: { id: "17841400000000001", followers_count: 5, media: { data: [] } } }, "fake.ig");
    expect(profile?.igUserId).toBe("17841400000000001");
    expect(parseBusinessDiscovery({ business_discovery: { followers_count: 5 } }, "fake.ig")?.igUserId).toBeUndefined();
  });
});
