/**
 * @jest-environment node
 *
 * An agency's join link puts the creator who signed up through it on that
 * agency's roster, named by their login, and never hands them a row the
 * agency made for someone else.
 */
jest.mock("@/lib/db", () => ({
  db: {
    orgJoinLink: { findUnique: jest.fn(), update: jest.fn() },
    creator: { findFirst: jest.fn(), create: jest.fn() },
    creatorUser: { findUnique: jest.fn() },
    creatorJoinRecord: { create: jest.fn() },
  },
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isWellFormedJoinCode, newJoinCode } from "@/lib/creators/joinLink";
import { joinAgency } from "@/lib/portal/joinAgency";

const mockDb = db as unknown as {
  orgJoinLink: { findUnique: jest.Mock; update: jest.Mock };
  creator: { findFirst: jest.Mock; create: jest.Mock };
  creatorUser: { findUnique: jest.Mock };
  creatorJoinRecord: { create: jest.Mock };
};

const session = { creatorUserId: "cu1", email: "maya@example.com" };
const CODE = "abcdefgh2345";
const live = { id: "jl1", orgId: "org1", revokedAt: null, organization: { name: "Acme Talent" } };

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.orgJoinLink.update.mockResolvedValue({});
  mockDb.creatorUser.findUnique.mockResolvedValue({
    name: "Maya",
    handle: "maya",
    platform: "INSTAGRAM",
    avatarUrl: null,
    bio: null,
    followersCount: 0,
  });
  mockDb.creator.create.mockResolvedValue({ id: "cr-new" });
});

describe("join codes", () => {
  it("are 12 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newJoinCode();
      expect(isWellFormedJoinCode(code)).toBe(true);
      expect(code).not.toMatch(/[01lo]/);
    }
  });

  it.each(["", "short", "ABCDEFGH2345", "abcdefgh23456", "abcdefgh234!", null, undefined])("rejects %p", (raw) => {
    expect(isWellFormedJoinCode(raw as string)).toBe(false);
  });
});

describe("joinAgency", () => {
  it("refuses a malformed code without touching the database", async () => {
    await expect(joinAgency(session, "not a code")).resolves.toMatchObject({ ok: false, status: 404 });
    expect(mockDb.orgJoinLink.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a link the agency turned off", async () => {
    mockDb.orgJoinLink.findUnique.mockResolvedValue({ ...live, revokedAt: new Date() });
    await expect(joinAgency(session, CODE)).resolves.toMatchObject({ ok: false, status: 404 });
    expect(mockDb.creator.create).not.toHaveBeenCalled();
  });

  it("puts a new creator on the link's org roster, named by their login", async () => {
    mockDb.orgJoinLink.findUnique.mockResolvedValue(live);
    mockDb.creator.findFirst.mockResolvedValue(null);
    await expect(joinAgency(session, CODE)).resolves.toEqual({
      ok: true,
      creatorId: "cr-new",
      agency: "Acme Talent",
      alreadyOnRoster: false,
    });
    expect(mockDb.creator.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: "org1", creatorUserId: "cu1", handle: "maya", platform: "INSTAGRAM", contactEmail: "maya@example.com" }),
      }),
    );
    expect(mockDb.creatorJoinRecord.create).toHaveBeenCalledWith({
      data: { creatorId: "cr-new", orgId: "org1", linkId: "jl1", creatorUserId: "cu1" },
    });
    expect(mockDb.orgJoinLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "jl1" }, data: expect.objectContaining({ joinedCount: { increment: 1 } }) }),
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org1", action: "creator.joined_via_link", entityId: "cr-new" }));
  });

  it("looks only for a row that names this login, never one matched by handle", async () => {
    mockDb.orgJoinLink.findUnique.mockResolvedValue(live);
    mockDb.creator.findFirst.mockResolvedValue(null);
    await joinAgency(session, CODE);
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org1", creatorUserId: "cu1", deletedAt: null } }),
    );
  });

  it("reuses the row when the creator is already on that roster", async () => {
    mockDb.orgJoinLink.findUnique.mockResolvedValue(live);
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr-old" });
    await expect(joinAgency(session, CODE)).resolves.toMatchObject({ ok: true, creatorId: "cr-old", alreadyOnRoster: true });
    expect(mockDb.creator.create).not.toHaveBeenCalled();
    expect(mockDb.orgJoinLink.update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("join link DDL", () => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { readFileSync } = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const { JOIN_LINK_DDL, isMissingJoinLinkTable } = require("@/lib/creators/joinLinkDdl") as typeof import("@/lib/creators/joinLinkDdl");
  /* eslint-enable @typescript-eslint/no-require-imports */

  it("only creates: no drop, every step guarded", () => {
    for (const stmt of JOIN_LINK_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ALTER COLUMN/i);
      expect(stmt).toMatch(/IF NOT EXISTS|DO \$\$/);
    }
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261123180000_org_join_links/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").replace(/;/g, "").trim();
    for (const stmt of JOIN_LINK_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it.each(["OrgJoinLink", "CreatorEmailVerification", "CreatorJoinRecord"])("creates every column %s names in the schema", (table) => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const model = new RegExp(`model ${table} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    const columns = [...model.matchAll(/^\s+(\w+)\s+(String|Int|DateTime)\??/gm)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(1);
    const create = JOIN_LINK_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS "${table}"`)) ?? "";
    for (const c of columns) expect(create).toContain(`"${c}"`);
  });

  it("confirms the creators who already exist only in the statement that creates the table", () => {
    const backfills = JOIN_LINK_DDL.filter((s) => /INSERT INTO "CreatorEmailVerification"/.test(s));
    expect(backfills).toHaveLength(1);
    expect(backfills[0]).toMatch(/IF to_regclass\('public\."CreatorEmailVerification"'\) IS NULL THEN\s+CREATE TABLE "CreatorEmailVerification"/);
    const create = JOIN_LINK_DDL.indexOf(JOIN_LINK_DDL.find((s) => s.startsWith('CREATE TABLE IF NOT EXISTS "CreatorEmailVerification"'))!);
    expect(JOIN_LINK_DDL.indexOf(backfills[0])).toBeLessThan(create);
  });

  it("knows a missing join link table, and nothing else", () => {
    expect(isMissingJoinLinkTable(Object.assign(new Error("x"), { code: "P2021" }))).toBe(true);
    expect(isMissingJoinLinkTable(new Error('relation "OrgJoinLink" does not exist'))).toBe(true);
    expect(isMissingJoinLinkTable(new Error("connection reset"))).toBe(false);
  });
});
