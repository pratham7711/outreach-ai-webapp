/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: {} }));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn() }));
jest.mock("@/lib/creators/importCreators", () => ({ planImport: jest.fn(), applyImport: jest.fn() }));

import { POST } from "@/app/api/creators/import/route";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { applyImport, planImport } from "@/lib/creators/importCreators";
import { MAX_IMPORT_PEOPLE } from "@/lib/creators/importParse";

const mockAuth = auth as jest.Mock;
const mockReady = rosterTablesReady as jest.Mock;
const mockPlan = planImport as jest.Mock;
const mockApply = applyImport as jest.Mock;

const HEADERS = ["Name", "Email", "Tiktok Link", "Tiktok Followers", "Instagram Link"];
const sheet = (n: number) => [
  HEADERS,
  ...Array.from({ length: n }, (_, i) => [`Page ${i}`, `p${i}@example.com`, `https://www.tiktok.com/@page${i}`, "10k", ""]),
];

function post(body: unknown) {
  return POST(new NextRequest("http://localhost/api/creators/import", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "MEMBER", email: "m@example.com" } });
  mockReady.mockResolvedValue(true);
  mockPlan.mockImplementation(async (_org: string, people: any[]) => ({
    people: people.map((person) => ({ person, action: "create", changes: [], creatorId: null })),
    newTags: [],
  }));
  mockApply.mockImplementation(async (_org: string, plan: any) => ({
    created: plan.people.length, updated: 0, unchanged: 0, creatorIds: plan.people.map((_: unknown, i: number) => `new-${i}`),
  }));
});

describe("POST /api/creators/import", () => {
  it("refuses a signed-out caller and a VIEWER", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await post({ rows: sheet(1), mode: "dryRun" })).status).toBe(401);
    mockAuth.mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await post({ rows: sheet(1), mode: "dryRun" })).status).toBe(403);
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it("takes the org from the session, never the body", async () => {
    await post({ rows: sheet(2), mode: "dryRun", orgId: "org-evil" });
    expect(mockPlan).toHaveBeenCalledWith("org-1", expect.any(Array), [], expect.any(Array));
  });

  it("answers 503 with a plain reason until the roster tables exist", async () => {
    mockReady.mockResolvedValueOnce(false);
    const res = await post({ rows: sheet(1), mode: "dryRun" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/roster migration/);
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it("dry-runs without writing and reports counts per person", async () => {
    const res = await post({ rows: sheet(3), mode: "dryRun", extraTags: ["Anime"] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(mockApply).not.toHaveBeenCalled();
    expect(body.counts).toEqual({ totalRows: 3, people: 3, create: 3, update: 0, correct: 0, unchanged: 0, rejected: 0, merged: 0, resolvedFromPosts: 0 });
    expect(body.people[0]).toMatchObject({ name: "Page 0", primary: { platform: "TIKTOK", handle: "page0" }, tags: ["Anime"] });
  });

  it("hands the planner each person as the first import read the same rows", async () => {
    const rows = [HEADERS, ["Page 0", "p0@example.com", "https://www.tiktok.com/@page0", 17.3, ""], ["Page 1", "p1@example.com", "https://www.tiktok.com/@page1", "31,2 mil", ""]];
    await post({ rows, mode: "commit", offset: 1, limit: 1 });
    const [, people, , earlier] = mockPlan.mock.calls[0];
    expect(people.map((p: any) => [p.rows, p.links[0].followersCount])).toEqual([[[3], 31200]]);
    expect(earlier.map((p: any) => [p.rows, p.links[0].followersCount])).toEqual([[[3], 31200000]]);
  });

  it("commits one slice at a time and says where to resume", async () => {
    const first = await (await post({ rows: sheet(5), mode: "commit", offset: 0, limit: 2, source: "Sign-up form" })).json();
    expect(first).toMatchObject({ created: 2, total: 5, nextOffset: 2, done: false });
    expect(mockPlan.mock.calls[0][1].map((p: any) => p.name)).toEqual(["Page 0", "Page 1"]);
    expect(mockApply).toHaveBeenCalledWith("org-1", expect.anything(), "Sign-up form");
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-1", action: "creators.import" }));

    const last = await (await post({ rows: sheet(5), mode: "commit", offset: 4, limit: 2 })).json();
    expect(last).toMatchObject({ created: 1, nextOffset: 5, done: true });
  });

  it("does not audit a chunk that changed nothing", async () => {
    mockApply.mockResolvedValueOnce({ created: 0, updated: 0, unchanged: 2, creatorIds: [] });
    await post({ rows: sheet(2), mode: "commit" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses an oversized sheet and a chunk larger than the cap", async () => {
    const big = await post({ rows: sheet(MAX_IMPORT_PEOPLE + 1), mode: "dryRun" });
    expect(big.status).toBe(413);
    expect((await post({ rows: sheet(1), mode: "commit", limit: 10_000 })).status).toBe(400);
    expect((await post({ rows: [], mode: "dryRun" })).status).toBe(400);
  });
});
