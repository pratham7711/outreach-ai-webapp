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
    creatorListItemDetail: { findMany: jest.fn() },
    // deriveAverageViews: Avg views measured from tracked posts. None by default.
    post: { groupBy: jest.fn().mockResolvedValue([]) },
    // latestTrackerReadings: dates the figures. No readings by default.
    creatorTrackerSnapshot: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(true) }));
// Absent by default, so the list export above runs exactly as it did before the rate card.
jest.mock("@/lib/lists/approvalTables", () => ({ listApprovalTablesReady: jest.fn().mockResolvedValue(false) }));

import { GET as exportRoster } from "@/app/api/creators/export/route";
import { GET as exportList } from "@/app/api/lists/[id]/export/route";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { MAX_BULK_CREATORS } from "@/lib/creators/rosterSelection";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";

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

  it("writes an account held on the creator row as a profile URL, never a bare @handle", async () => {
    const typed = { ...plain, id: "t", platform: "TIKTOK", handle: "@Walk_Typed" };
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "t" }]).mockResolvedValueOnce([typed]);
    const lines = (await (await exportRoster(get("/api/creators/export?format=csv&ids=t"))).text()).split("\n");
    expect(lines[1]).toContain('"https://www.tiktok.com/@walk_typed"');
    expect(lines[1]).not.toContain(`"'@`);
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

describe("unknown figures in the export (plan §13 A1)", () => {
  /* Followers and Avg views are Float @default(0), so a 0 on file is "never
     read", not "no audience". The export writes "—" for it -- never 0 and
     never an empty cell -- and the last column says why. */
  const unread = {
    ...evil,
    id: "u",
    name: "Unread Creator",
    followersCount: 0,
    averageViews: 0,
    trackerLastAttemptAt: null,
    trackerLastError: null,
    tagLinks: [],
    detail: null,
    _count: { posts: 3 },
    profileLinks: [
      {
        platform: "TIKTOK",
        handle: "fake.unread",
        url: "https://www.tiktok.com/@fake.unread",
        followersCount: 0,
        isPrimary: true,
        refreshedAt: new Date("2026-09-30T00:00:00Z"),
        refreshError: "no-such-account: statusCode 10221",
      },
    ],
  };

  const sheet = async (res: Response) => {
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Creators, { header: 1, defval: null });
    const header = rows[0] as string[];
    return { header, rows: rows.slice(1), col: (row: unknown[], name: string) => row[header.indexOf(name)] };
  };

  it("writes a dash, with the reason, for every figure it does not have", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "u" }]).mockResolvedValueOnce([unread]);
    const { header, rows, col } = await sheet(await exportRoster(get("/api/creators/export?ids=u")));
    // Right after Added, where it has always been; the age columns follow it.
    expect(header[header.indexOf("Added") + 1]).toBe("Why a figure is —");
    const [row] = rows;
    expect(col(row, "TikTok followers")).toBe("—");
    expect(col(row, "Followers (primary)")).toBe("—");
    expect(col(row, "Avg views")).toBe("—");
    // No account on Instagram is no account, not an unknown count.
    expect(col(row, "Instagram")).toBeNull();
    expect(col(row, "Instagram followers")).toBeNull();
    const notes = String(col(row, "Why a figure is —"));
    expect(notes).toMatch(/^TikTok followers, Followers \(primary\): We could not find this handle/);
    expect(notes).toContain("Avg views: None of their 3 tracked posts has a view count yet");
  });

  it("writes the dash into the CSV too, where the formula guard leaves it alone", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "u" }]).mockResolvedValueOnce([unread]);
    const lines = (await (await exportRoster(get("/api/creators/export?format=csv&ids=u"))).text()).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"https://www.tiktok.com/@fake.unread","—"');
    expect(lines[1]).not.toContain(`"'—"`);
    expect(lines[0]).toContain('"Added","Why a figure is —","Followers as of"');
  });

  it("uses the Avg views the roster shows, measured from tracked posts", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([evil]);
    mdb.post.groupBy.mockResolvedValueOnce([{ creatorId: "a", _avg: { viewsCount: 1234.4 } }]);
    const { rows, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(rows[0], "Avg views")).toBe(1234);
    expect(col(rows[0], "Followers (primary)")).toBe(150000);
    // Every figure known: nothing to explain, and the cell is left empty.
    expect(col(rows[0], "Why a figure is —")).toBeNull();
    expect(mdb.post.groupBy.mock.calls[0][0].where).toEqual({ creatorId: { in: ["a"] }, viewsCount: { gt: 0 } });
  });

  it("never writes 0 for an account's follower count", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([
      { ...evil, profileLinks: [{ ...evil.profileLinks[0] }, { ...evil.profileLinks[1], followersCount: 0 }] },
    ]);
    const { rows, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(rows[0], "TikTok followers")).toBe(150000);
    expect(col(rows[0], "Instagram followers")).toBe("—");
    expect(String(col(rows[0], "Why a figure is —"))).toMatch(/^Instagram followers: /);
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

describe("GET /api/lists/[id]/export with the rate card", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  beforeEach(() => (listApprovalTablesReady as jest.Mock).mockResolvedValue(true));
  afterEach(() => (listApprovalTablesReady as jest.Mock).mockResolvedValue(false));

  it("follows the card's order and appends the list rate, note and the client's verdict", async () => {
    mdb.creatorList.findFirst.mockResolvedValue({ name: "Anime Pages" });
    // Newest first; the card has dragged "a" to the top.
    mdb.creatorListItem.findMany.mockResolvedValue([{ id: "item-b", creatorId: "b" }, { id: "item-a", creatorId: "a" }]);
    mdb.creatorListItemDetail.findMany.mockResolvedValue([
      { itemId: "item-a", rate: 900, notes: "fast", sortOrder: 0, decision: "REJECTED", decisionNote: "Off-brand", decidedAt: null },
    ]);
    mdb.creator.findMany.mockResolvedValue([evil, plain]);
    const res = await exportList(get("/api/lists/l1/export?format=csv"), params("l1"));
    const lines = (await res.text()).split("\n");
    // The card's columns follow everything the roster export has, and the age
    // columns come after them, so neither moves the other.
    expect(lines[0]).toMatch(/"List rate \(USD\)","Notes","Client decision","Client note","Followers as of","Followers source","Avg views as of","Avg views source","Status"$/);
    expect(lines[1].startsWith(`"'=HYPERLINK`)).toBe(true);
    expect(lines[1]).toContain(',"900","fast","Declined","Off-brand","—",');
    // No detail row: no rate, no note, undecided.
    expect(lines[2]).toContain(',"","","Pending","","—",');
    expect(mdb.creatorListItemDetail.findMany.mock.calls[0][0].where).toEqual({ orgId: "org-1", listId: "l1" });
  });
});

describe("age columns in the export (plan A2/A6)", () => {
  const HOUR = 60 * 60 * 1000;
  const sheet = async (res: Response) => {
    const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Creators, { header: 1, defval: null });
    const header = rows[0] as string[];
    return { header, row: rows[1], col: (row: unknown[], name: string) => row[header.indexOf(name)] };
  };
  const withPrimary = (link: Record<string, unknown>) => ({
    ...evil,
    profileLinks: [{ ...evil.profileLinks[0], ...link }],
  });

  it("ends every row with the five age columns, after everything else", async () => {
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([evil]);
    const { header } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(header.slice(-6)).toEqual([
      "Why a figure is —",
      "Followers as of",
      "Followers source",
      "Avg views as of",
      "Avg views source",
      "Status",
    ]);
  });

  it("dates followers by the primary account's read when it produced the count", async () => {
    const readAt = new Date(Date.now() - 2 * HOUR);
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([withPrimary({ refreshedAt: readAt, refreshError: null })]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Followers as of")).toBe(readAt.toISOString());
    expect(col(row, "Followers source")).toBe("Profile read");
    expect(col(row, "Status")).toBe("Current");
  });

  it("calls a profile figure stale past twice its daily cadence", async () => {
    const readAt = new Date(Date.now() - 49 * HOUR);
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([withPrimary({ refreshedAt: readAt, refreshError: null })]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Status")).toBe("Stale");
  });

  it("prefers a newer tracker reading of the same count", async () => {
    const readAt = new Date(Date.now() - 20 * HOUR);
    const trackedAt = new Date(Date.now() - 1 * HOUR);
    mdb.creatorTrackerSnapshot.groupBy.mockResolvedValueOnce([{ creatorId: "a", _max: { recordedAt: trackedAt } }]);
    mdb.creatorTrackerSnapshot.findMany.mockResolvedValueOnce([{ creatorId: "a", followersCount: 150000, avgViews: 0, recordedAt: trackedAt }]);
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([withPrimary({ refreshedAt: readAt, refreshError: null })]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Followers as of")).toBe(trackedAt.toISOString());
    expect(col(row, "Followers source")).toBe("Tracker reading");
    // Scoped to the caller's org through the creator.
    expect(mdb.creatorTrackerSnapshot.groupBy.mock.calls[0][0].where).toEqual({ creatorId: { in: ["a"] }, creator: { orgId: "org-1" } });
  });

  it("gives a hand-edited count no age rather than a read's that did not produce it", async () => {
    mdb.creator.findMany
      .mockResolvedValueOnce([{ id: "a" }])
      .mockResolvedValueOnce([{ ...withPrimary({ refreshedAt: new Date(), refreshError: null }), followersCount: 99000 }]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Followers (primary)")).toBe(99000);
    expect(col(row, "Followers as of")).toBe("—");
    expect(col(row, "Followers source")).toBe("Time not recorded");
    expect(col(row, "Status")).toBe("Age unknown");
  });

  it("says the last read failed when the held count cannot be dated", async () => {
    mdb.creator.findMany
      .mockResolvedValueOnce([{ id: "a" }])
      .mockResolvedValueOnce([withPrimary({ refreshedAt: new Date(), refreshError: "rate-limited" })]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    // The last good value stays; its time is what was lost.
    expect(col(row, "Followers (primary)")).toBe(150000);
    expect(col(row, "Followers source")).toBe("Last read failed; time not recorded");
  });

  it("dates a posts-derived Avg views by the newest post read", async () => {
    const synced = new Date("2026-09-30T06:00:00Z");
    mdb.post.groupBy.mockResolvedValueOnce([{ creatorId: "a", _avg: { viewsCount: 1234 }, _max: { lastSyncedAt: synced, lastFreshAt: null } }]);
    mdb.creator.findMany.mockResolvedValueOnce([{ id: "a" }]).mockResolvedValueOnce([evil]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Avg views")).toBe(1234);
    expect(col(row, "Avg views as of")).toBe(synced.toISOString());
    expect(col(row, "Avg views source")).toBe("Tracked posts");
  });

  it("writes Not read for a creator with no figure at all", async () => {
    mdb.creator.findMany
      .mockResolvedValueOnce([{ id: "a" }])
      .mockResolvedValueOnce([{ ...evil, followersCount: 0, profileLinks: [] }]);
    const { row, col } = await sheet(await exportRoster(get("/api/creators/export?ids=a")));
    expect(col(row, "Followers as of")).toBe("—");
    expect(col(row, "Status")).toBe("Not read");
  });
});
