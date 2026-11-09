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
    campaignTemplate: { count: jest.fn() },
  },
}));

import {
  CAMPAIGN_TEMPLATE_COLUMNS,
  CAMPAIGN_TEMPLATE_DDL,
  CAMPAIGN_TEMPLATE_TABLE,
  isMissingTemplatesTable,
} from "@/lib/campaigns/templates/ddl";
import { GET, POST } from "@/app/api/admin/migrate-campaign-templates/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & { campaignTemplate: { count: jest.Mock } };

describe("CampaignTemplate DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of CAMPAIGN_TEMPLATE_DDL) expect(stmt).toMatch(/IF NOT EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    for (const stmt of CAMPAIGN_TEMPLATE_DDL) expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
  });

  it("only adds: one new table with its index and its key, never a change to an existing table", () => {
    for (const stmt of CAMPAIGN_TEMPLATE_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ADD COLUMN|ALTER COLUMN|\bUPDATE\b\s+"|\bDELETE\b\s+FROM/i);
      for (const m of stmt.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(m[1]).toBe(CAMPAIGN_TEMPLATE_TABLE);
      for (const m of stmt.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "[^"]+" ON "([^"]+)"/g)) {
        expect(m[1]).toBe(CAMPAIGN_TEMPLATE_TABLE);
      }
    }
  });

  it("creates every column the admin route checks for, and no more", () => {
    const table = CAMPAIGN_TEMPLATE_DDL.find((s) => s.includes(`CREATE TABLE IF NOT EXISTS "${CAMPAIGN_TEMPLATE_TABLE}"`))!;
    for (const col of CAMPAIGN_TEMPLATE_COLUMNS) expect(table).toContain(`"${col}"`);
    const declared = [...table.matchAll(/^\s*"([^"]+)" [A-Z]/gm)].map((m) => m[1]).sort();
    expect(declared).toEqual([...CAMPAIGN_TEMPLATE_COLUMNS].sort());
  });

  it("indexes the list read (org, not deleted)", () => {
    expect(CAMPAIGN_TEMPLATE_DDL.join("\n")).toContain(
      `CREATE INDEX IF NOT EXISTS "CampaignTemplate_orgId_deletedAt_idx" ON "CampaignTemplate"("orgId", "deletedAt")`,
    );
  });

  it("goes when its organization goes", () => {
    expect(CAMPAIGN_TEMPLATE_DDL.join("\n")).toMatch(/REFERENCES "Organization"\("id"\) ON DELETE CASCADE/);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261108120000_campaign_templates/migration.sql"),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of CAMPAIGN_TEMPLATE_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("matches the Prisma model, so a generated client reads what the DDL made", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = schema.match(/model CampaignTemplate \{([\s\S]*?)\n\}/)?.[1] ?? "";
    const fields = [...model.matchAll(/^\s+(\w+)\s+(?:String|Json|DateTime)\??/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual([...CAMPAIGN_TEMPLATE_COLUMNS].sort());
    expect(model).toMatch(/@@index\(\[orgId, deletedAt\]\)/);
    expect(model).toMatch(/onDelete: Cascade/);
  });

  it("recognises a missing CampaignTemplate table, and nothing else", () => {
    expect(isMissingTemplatesTable({ code: "P2021" })).toBe(true);
    expect(isMissingTemplatesTable(Object.assign(new Error("The table `public.CampaignTemplate` does not exist"), { code: "P2021" }))).toBe(true);
    expect(isMissingTemplatesTable(new Error('relation "CampaignTemplate" does not exist'))).toBe(true);
    expect(isMissingTemplatesTable(Object.assign(new Error("The table `public.CampaignRules` does not exist"), { code: "P2021" }))).toBe(false);
    expect(isMissingTemplatesTable(new Error('relation "Campaign" does not exist'))).toBe(false);
    expect(isMissingTemplatesTable(new Error("connection reset"))).toBe(false);
  });
});

describe("/api/admin/migrate-campaign-templates", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-campaign-templates", {
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

  it("does not exist without ADMIN_MIGRATE_TOKEN, and refuses a wrong or missing token", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(req("GET", "anything"))).status).toBe(404);
    expect((await POST(req("POST", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await GET(req("GET", "wrong"))).status).toBe(401);
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect((await POST(req("POST"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing table without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body.ready).toBe(false);
    expect(body.missingColumns).toEqual({ [CAMPAIGN_TEMPLATE_TABLE]: CAMPAIGN_TEMPLATE_COLUMNS });
    expect(body.rows).toEqual({ [CAMPAIGN_TEMPLATE_TABLE]: 0 });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.campaignTemplate.count).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(CAMPAIGN_TEMPLATE_COLUMNS.map((column_name) => ({ column_name })));
    mdb.campaignTemplate.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(CAMPAIGN_TEMPLATE_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after.ready).toBe(true);
    expect(body.after.rows).toEqual({ [CAMPAIGN_TEMPLATE_TABLE]: 0 });
  });

  it("POST says what failed instead of claiming success", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    mdb.$executeRawUnsafe.mockRejectedValueOnce(new Error("permission denied for schema public"));
    const res = await POST(req("POST", "test-admin-token"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("permission denied");
  });
});
