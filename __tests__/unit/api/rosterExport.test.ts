/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn(), count: jest.fn() },
    creatorList: { findFirst: jest.fn() },
    creatorListItem: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));

import { GET as exportRoster } from "@/app/api/creators/export/route";
import { GET as exportList } from "@/app/api/lists/[id]/export/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { MAX_BULK_CREATORS } from "@/lib/creators/rosterSelection";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const get = (url: string) => new NextRequest(`http://localhost${url}`);

const evil = {
  id: "a",
  name: '=HYPERLINK("http://evil.example","claim payout")',
  handle: "@evil",
  platform: "TIKTOK",
  followersCount: 150000,
  averageViews: 0,
  rate: 40,
  contactEmail: "a@example.com",
  addedAt: new Date("2026-09-01T00:00:00Z"),
  tagLinks: [{ tag: { name: "Anime" } }, { tag: { name: "+Priority" } }],
  profileLinks: [
    { platform: "TIKTOK", handle: "evil", url: "https://www.tiktok.com/@evil", followersCount: 150000, isPrimary: true },
    { platform: "INSTAGRAM", handle: "evil.ig", url: "https://instagram.com/evil.ig", followersCount: 8000, isPrimary: false },
  ],
  detail: { country: "Brazil", audienceCountry: "Brazil, Portugal", niche: "Edits" },
};
const plain = { ...evil, id: "b", name: "Plain Name", tagLinks: [], profileLinks: [], detail: null, platform: "YOUTUBE", handle: "plain" };

beforeEach(() => {
  jest.clearAllMocks();
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role: "VIEWER" } });
});

describe("GET /api/creators/export", () => {
  it("neutralises formulas in the CSV and keeps the order it was given", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "b" }, { id: "a" }]).mockResolvedValueOnce([evil, plain]);
    const res = await exportRoster(get("/api/creators/export?format=csv&ids=b,a"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="Creator roster \d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = (await res.text()).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('"Plain Name"')).toBe(true);
    expect(lines[2].startsWith(`"'=HYPERLINK(""http://evil.example"",""claim payout"")"`)).toBe(true);
    expect(lines[2]).toContain(`"'+Priority, Anime"`);
    expect(lines[2]).toContain('"https://www.tiktok.com/@evil","150000","https://instagram.com/evil.ig","8000"');
    expect(lines[0]).toContain('"Email"');
    expect(lines[2]).toContain('"a@example.com"');
  });

  it("stores a formula-looking name as text in the xlsx", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([evil]);
    const res = await exportRoster(get("/api/creators/export?ids=a"));
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const cell = wb.Sheets.Creators.A2;
    expect(cell.t).toBe("s");
    expect(cell.f).toBeUndefined();
    expect(cell.v).toBe(evil.name);
  });

  it("resolves a filter query in the caller's org", async () => {
    mdb.creator.count.mockResolvedValue(1);
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "b" }]).mockResolvedValueOnce([plain]);
    await exportRoster(get("/api/creators/export?format=csv&tags=Anime&orgId=org-2"));
    expect(mdb.creator.count.mock.calls[0][0].where).toMatchObject({ orgId: "org-1", tagLinks: { some: { tag: { name: { in: ["Anime"] } } } } });
    expect(mdb.creator.findMany.mock.calls[1][0].where).toEqual({ id: { in: ["b"] }, orgId: "org-1", deletedAt: null });
  });

  it("refuses ids from another org and more than the cap", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]);
    expect((await exportRoster(get("/api/creators/export?ids=a,theirs"))).status).toBe(404);
    const many = Array.from({ length: MAX_BULK_CREATORS + 1 }, (_, i) => `c${i}`).join(",");
    expect((await exportRoster(get(`/api/creators/export?ids=${many}`))).status).toBe(413);
  });

  it("is closed to the signed-out", async () => {
    (auth as jest.Mock).mockResolvedValue(null);
    expect((await exportRoster(get("/api/creators/export?ids=a"))).status).toBe(401);
  });
});

describe("GET /api/lists/[id]/export", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });

  it("exports the list's members, newest first, named after the list", async () => {
    mdb.creatorList.findFirst.mockResolvedValue({ name: "Anime Pages" });
    mdb.creatorListItem.findMany.mockResolvedValue([{ creatorId: "b" }, { creatorId: "a" }]);
    mdb.creator.findMany.mockResolvedValue([evil, plain]);
    const res = await exportList(get("/api/lists/l1/export?format=csv"), params("l1"));
    expect(res.headers.get("content-disposition")).toMatch(/filename="Anime Pages \d{4}-\d{2}-\d{2}\.csv"/);
    expect(mdb.creatorList.findFirst.mock.calls[0][0].where).toEqual({ id: "l1", orgId: "org-1" });
    expect(mdb.creatorListItem.findMany.mock.calls[0][0]).toMatchObject({
      where: { listId: "l1", creator: { orgId: "org-1", deletedAt: null } },
      orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    });
    const lines = (await res.text()).split("\n");
    expect(lines.map((l) => l.split(",")[0])).toEqual(['"Name"', '"Plain Name"', `"'=HYPERLINK(""http://evil.example""`]);
  });

  it("404s another org's list without reading its members", async () => {
    mdb.creatorList.findFirst.mockResolvedValue(null);
    expect((await exportList(get("/api/lists/theirs/export"), params("theirs"))).status).toBe(404);
    expect(mdb.creatorListItem.findMany).not.toHaveBeenCalled();
  });
});
