/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    campaignRules: { count: jest.fn() },
    postAnnotation: { count: jest.fn() },
  },
}));

import {
  CAMPAIGN_RULES_COLUMNS,
  CAMPAIGN_RULES_DDL,
  CAMPAIGN_RULES_TABLE,
  POST_ANNOTATION_COLUMNS,
  POST_ANNOTATION_TABLE,
  isMissingRulesTable,
} from "@/lib/campaigns/rulesDdl";
import { GET, POST } from "@/app/api/admin/migrate-campaign-rules/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & {
  campaignRules: { count: jest.Mock };
  postAnnotation: { count: jest.Mock };
};
const OWN_TABLES = [CAMPAIGN_RULES_TABLE, POST_ANNOTATION_TABLE];

describe("CampaignRules + PostAnnotation DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of CAMPAIGN_RULES_DDL) expect(stmt).toMatch(/IF NOT EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    for (const stmt of CAMPAIGN_RULES_DDL) expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
  });

  it("only adds: two new tables with their index and keys, never a change to Campaign or Post", () => {
    for (const stmt of CAMPAIGN_RULES_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ADD COLUMN|ALTER COLUMN/i);
      for (const m of stmt.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(OWN_TABLES).toContain(m[1]);
      for (const m of stmt.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "[^"]+" ON "([^"]+)"/g)) expect(OWN_TABLES).toContain(m[1]);
    }
  });

  it("creates every column the admin route checks for", () => {
    const rules = CAMPAIGN_RULES_DDL.find((s) => s.includes(`CREATE TABLE IF NOT EXISTS "${CAMPAIGN_RULES_TABLE}"`))!;
    const notes = CAMPAIGN_RULES_DDL.find((s) => s.includes(`CREATE TABLE IF NOT EXISTS "${POST_ANNOTATION_TABLE}"`))!;
    for (const col of CAMPAIGN_RULES_COLUMNS) expect(rules).toContain(`"${col}"`);
    for (const col of POST_ANNOTATION_COLUMNS) expect(notes).toContain(`"${col}"`);
  });

  it("goes when its campaign or post goes", () => {
    const all = CAMPAIGN_RULES_DDL.join("\n");
    expect(all).toMatch(/REFERENCES "Campaign"\("id"\) ON DELETE CASCADE/);
    expect(all).toMatch(/REFERENCES "Post"\("id"\) ON DELETE CASCADE/);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261030120000_campaign_rules/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of CAMPAIGN_RULES_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("recognises a missing table on either name, and nothing else", () => {
    expect(isMissingRulesTable({ code: "P2021" })).toBe(true);
    expect(isMissingRulesTable(new Error('relation "PostAnnotation" does not exist'))).toBe(true);
    expect(isMissingRulesTable(new Error('relation "Campaign" does not exist'))).toBe(false);
    expect(isMissingRulesTable(new Error("connection reset"))).toBe(false);
  });
});

describe("/api/admin/migrate-campaign-rules", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-campaign-rules", {
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
    expect((await POST(req("POST"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports both missing tables without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body.ready).toBe(false);
    expect(body.missingColumns).toEqual({
      [CAMPAIGN_RULES_TABLE]: CAMPAIGN_RULES_COLUMNS,
      [POST_ANNOTATION_TABLE]: POST_ANNOTATION_COLUMNS,
    });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.campaignRules.count).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    const cols = (names: string[]) => names.map((column_name) => ({ column_name }));
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(cols(CAMPAIGN_RULES_COLUMNS))
      .mockResolvedValueOnce(cols(POST_ANNOTATION_COLUMNS));
    mdb.campaignRules.count.mockResolvedValue(0);
    mdb.postAnnotation.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(CAMPAIGN_RULES_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after.ready).toBe(true);
  });
});
