/**
 * @jest-environment node
 *
 * Creator audience: the weekly Instagram read, the roster's one-line summary,
 * a campaign's estimate, the table's DDL and the admin route that applies it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    creatorAudienceSnapshot: { count: jest.fn() },
  },
}));

import { AUDIENCE_READS, readInstagramAudience, type AudienceMix } from "@/lib/platforms/instagramAccountInsights";
import { summarizeAudience } from "@/lib/creators/audienceSummary";
import { campaignAudience, pickAudience } from "@/lib/creators/campaignAudience";
import type { StoredAudience } from "@/lib/creators/audienceSnapshots";
import { CREATOR_AUDIENCE_DDL, CREATOR_AUDIENCE_TABLES, isMissingCreatorAudienceTable } from "@/lib/creators/audienceDdl";
import { GET, POST } from "@/app/api/admin/migrate-creator-audience/route";
import { db } from "@/lib/db";

const mix = (p: Partial<AudienceMix>): AudienceMix => ({ country: [], city: [], age: [], gender: [], ...p });
const reading = (audience: StoredAudience["audience"], timeframe: StoredAudience["timeframe"], day: string, m: AudienceMix): StoredAudience => ({
  audience,
  timeframe,
  day,
  readAt: `${day}T10:00:00.000Z`,
  mix: m,
});

describe("readInstagramAudience", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("asks once per audience, window and breakdown, and keeps an audience Instagram withheld", async () => {
    const seen: URLSearchParams[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const q = new URL(String(input)).searchParams;
      seen.push(q);
      const metric = q.get("metric");
      const body =
        metric === "follower_demographics" && q.get("breakdown") === "country"
          ? { data: [{ name: metric, total_value: { breakdowns: [{ dimension_keys: ["country"], results: [{ dimension_values: ["IN"], value: 70 }, { dimension_values: ["US"], value: 30 }] }] } }] }
          : { data: [] };
      return { ok: true, status: 200, headers: new Headers(), json: async () => body } as unknown as Response;
    }) as typeof fetch;

    const readings = await readInstagramAudience("tok", "ig1");
    expect(seen).toHaveLength(AUDIENCE_READS.length * 4);
    for (const q of seen) {
      expect(q.get("period")).toBe("lifetime");
      expect(q.get("metric_type")).toBe("total_value");
      expect(["this_week", "this_month"]).toContain(q.get("timeframe"));
    }
    expect(readings).toHaveLength(3);
    const followers = readings.find((r) => r.audience === "followers")!;
    expect(followers.mix.country).toEqual([{ key: "IN", value: 70 }, { key: "US", value: 30 }]);
    expect(readings.filter((r) => r.audience === "engaged").every((r) => r.mix.country.length === 0)).toBe(true);
  });
});

describe("summarizeAudience", () => {
  it("names the top country and age band, and women and men as shares", () => {
    const s = summarizeAudience(
      mix({
        country: [{ key: "IN", value: 60 }, { key: "US", value: 40 }],
        age: [{ key: "18-24", value: 50 }, { key: "25-34", value: 50 - 20 }, { key: "35-44", value: 20 }],
        gender: [{ key: "F", value: 60 }, { key: "M", value: 30 }, { key: "U", value: 10 }],
      }),
      "2026-11-20",
    );
    expect(s).toEqual({ country: { key: "IN", share: 0.6 }, women: 0.6, men: 0.3, age: { key: "18-24", share: 0.5 }, day: "2026-11-20" });
  });

  it("is nothing for an audience Instagram did not describe", () => {
    expect(summarizeAudience(mix({}), "2026-11-20")).toBeNull();
  });
});

describe("campaign audience estimate", () => {
  const india = mix({ country: [{ key: "IN", value: 1 }], gender: [{ key: "F", value: 1 }] });
  const us = mix({ country: [{ key: "US", value: 1 }], gender: [{ key: "M", value: 1 }] });
  const uk = mix({ country: [{ key: "GB", value: 1 }] });

  it("prefers that week's engaged audience, then the month's, then followers", () => {
    const readings = [
      reading("followers", "this_month", "2026-11-01", uk),
      reading("engaged", "this_month", "2026-11-20", us),
      reading("engaged", "this_week", "2026-11-12", india),
    ];
    expect(pickAudience(readings, "2026-11-10")).toEqual({ basis: "engaged_week", mix: india });
    expect(pickAudience(readings, "2026-11-04")).toEqual({ basis: "engaged_month", mix: us });
    expect(pickAudience(readings, "2026-09-01")).toEqual({ basis: "followers", mix: uk });
  });

  it("never uses a reading taken before the post for an engaged audience", () => {
    expect(pickAudience([reading("engaged", "this_week", "2026-11-05", india)], "2026-11-10")).toBeNull();
  });

  it("skips readings Instagram withheld", () => {
    expect(pickAudience([reading("engaged", "this_week", "2026-11-12", mix({}))], "2026-11-10")).toBeNull();
  });

  it("splits each post's reach by its creator's audience and reports what it covers", () => {
    const readings = new Map([
      ["a", [reading("engaged", "this_week", "2026-11-12", india)]],
      ["b", [reading("followers", "this_month", "2026-11-12", us)]],
    ]);
    const out = campaignAudience(
      [
        { creatorId: "a", postedAt: "2026-11-10", weight: 300 },
        { creatorId: "b", postedAt: "2026-11-10", weight: 100 },
        { creatorId: "c", postedAt: "2026-11-10", weight: 600 },
      ],
      readings,
    );
    expect(out.breakdowns.country).toEqual([
      { key: "IN", people: 300, share: 0.75 },
      { key: "US", people: 100, share: 0.25 },
    ]);
    expect(out.breakdowns.gender.map((g) => g.key)).toEqual(["F", "M"]);
    expect(out).toMatchObject({ coveredWeight: 400, totalWeight: 1000, coveredPosts: 2, totalPosts: 3, uncoveredCreatorIds: ["c"] });
    expect(out.basis).toEqual({ engaged_week: 1, engaged_month: 0, followers: 1 });
    expect(out.creators.map((c) => [c.creatorId, c.weight, c.topCountry?.key ?? null, c.women])).toEqual([
      ["c", 600, null, null],
      ["a", 300, "IN", 1],
      ["b", 100, "US", 0],
    ]);
  });

  it("measures cities against the whole audience, since Instagram lists only the top 45", () => {
    const m = mix({ country: [{ key: "IN", value: 100 }], city: [{ key: "Mumbai, Maharashtra", value: 20 }, { key: "Delhi, Delhi", value: 10 }] });
    const out = campaignAudience([{ creatorId: "a", postedAt: "2026-11-10", weight: 1000 }], new Map([["a", [reading("followers", "this_month", "2026-11-12", m)]]]));
    expect(out.breakdowns.city).toEqual([
      { key: "Mumbai, Maharashtra", people: 200, share: 0.2 },
      { key: "Delhi, Delhi", people: 100, share: 0.1 },
    ]);
  });

  it("treats a missing or negative weight as zero without dropping the post's coverage", () => {
    const out = campaignAudience([{ creatorId: "a", postedAt: "2026-11-10", weight: Number.NaN }], new Map([["a", [reading("followers", "this_month", "2026-11-12", india)]]]));
    expect(out).toMatchObject({ coveredPosts: 1, coveredWeight: 0, totalWeight: 0 });
    expect(out.breakdowns.country).toEqual([]);
  });
});

describe("creator audience DDL", () => {
  it("only creates: no drop, every step guarded", () => {
    for (const stmt of CREATOR_AUDIENCE_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ALTER COLUMN/i);
      expect(stmt).toMatch(/IF NOT EXISTS|DO \$\$/);
    }
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261123120000_creator_audience_snapshots/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").replace(/;/g, "").trim();
    for (const stmt of CREATOR_AUDIENCE_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("creates every column the schema names", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = /model CreatorAudienceSnapshot \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    const columns = [...model.matchAll(/^\s+(\w+)\s+(String|Int|DateTime|Json|Platform)\??/gm)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(8);
    const create = CREATOR_AUDIENCE_DDL.find((s) => s.startsWith('CREATE TABLE IF NOT EXISTS "CreatorAudienceSnapshot"')) ?? "";
    for (const c of columns) expect(create).toContain(`"${c}"`);
  });

  it("knows a missing audience table, and nothing else", () => {
    expect(isMissingCreatorAudienceTable(Object.assign(new Error("x"), { code: "P2021" }))).toBe(true);
    expect(isMissingCreatorAudienceTable(new Error('relation "CreatorAudienceSnapshot" does not exist'))).toBe(true);
    expect(isMissingCreatorAudienceTable(new Error("connection reset"))).toBe(false);
  });
});

describe("/api/admin/migrate-creator-audience", () => {
  const mdb = db as unknown as Record<string, jest.Mock> & { creatorAudienceSnapshot: { count: jest.Mock } };
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-creator-audience", { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const saved = process.env.ADMIN_MIGRATE_TOKEN;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
  });
  afterAll(() => {
    process.env.ADMIN_MIGRATE_TOKEN = saved;
  });

  it("refuses without the token and changes nothing", async () => {
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect((await GET(req("GET"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order", async () => {
    mdb.$queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce(CREATOR_AUDIENCE_TABLES.map((table_name) => ({ table_name })));
    mdb.creatorAudienceSnapshot.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(CREATOR_AUDIENCE_DDL);
    expect(body).toMatchObject({ ok: true, before: { ready: false }, after: { ready: true, missingTables: [] } });
  });
});
