/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

const orgFindMany = jest.fn();
const orgFindUnique = jest.fn();
const planImport = jest.fn();
const auditRoster = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    organization: {
      findMany: (...a: unknown[]) => orgFindMany(...a),
      findUnique: (...a: unknown[]) => orgFindUnique(...a),
    },
  },
}));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: async () => true }));
jest.mock("@/lib/creators/importCreators", () => ({ planImport: (...a: unknown[]) => planImport(...a) }));
jest.mock("@/lib/creators/rosterAudit", () => ({ auditRoster: (...a: unknown[]) => auditRoster(...a) }));

import { GET, POST } from "@/app/api/admin/roster-audit/route";

const URL_ = "http://localhost/api/admin/roster-audit";
const get = (q = "", auth?: string) =>
  new NextRequest(`${URL_}${q}`, { method: "GET", headers: auth ? { authorization: auth } : {} });
const post = (body: unknown, auth?: string) =>
  new NextRequest(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

const SHEET = [
  ["Name", "Email", "TikTok link", "TikTok followers"],
  ["Secret Person", "secret@example.com", "https://www.tiktok.com/@realhandle", "17.3"],
];
const MAPPING = ["name", "email", "tiktokLink", "tiktokFollowers"];

const saved = process.env.ADMIN_MIGRATE_TOKEN;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_MIGRATE_TOKEN = "t0ken";
  orgFindUnique.mockResolvedValue({ id: "org-1", name: "Agency" });
});
afterAll(() => {
  process.env.ADMIN_MIGRATE_TOKEN = saved;
});

describe("/api/admin/roster-audit", () => {
  it("does not exist on a deployment without ADMIN_MIGRATE_TOKEN", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(get("", "Bearer t0ken"))).status).toBe(404);
    expect((await POST(post({}, "Bearer t0ken"))).status).toBe(404);
  });

  it("refuses a missing or wrong token before reading anything", async () => {
    expect((await GET(get("?org=org-1"))).status).toBe(401);
    expect((await POST(post({ orgId: "org-1", rows: SHEET }, "Bearer nope!"))).status).toBe(401);
    expect(orgFindUnique).not.toHaveBeenCalled();
    expect(auditRoster).not.toHaveBeenCalled();
    expect(planImport).not.toHaveBeenCalled();
  });

  it("GET without an org lists orgs and their creator counts", async () => {
    orgFindMany.mockResolvedValueOnce([{ id: "org-1", name: "Agency", _count: { creators: 3 } }]);
    const body = await (await GET(get("", "Bearer t0ken"))).json();
    expect(body).toEqual({ ok: true, orgs: [{ id: "org-1", name: "Agency", creators: 3 }] });
  });

  it("GET audits only the org asked for, and 404s an unknown one", async () => {
    auditRoster.mockResolvedValueOnce({ creators: 0 });
    expect((await (await GET(get("?org=org-1", "Bearer t0ken"))).json()).org).toEqual({ id: "org-1", name: "Agency" });
    expect(auditRoster).toHaveBeenCalledWith("org-1");
    orgFindUnique.mockResolvedValueOnce(null);
    expect((await GET(get("?org=nope", "Bearer t0ken"))).status).toBe(404);
  });

  it("POST plans against the org's roster and returns handles, never names or emails", async () => {
    planImport.mockImplementation(async (_org: string, people: { links: unknown[] }[]) => ({
      newTags: [],
      people: people.map((person) => ({
        person,
        action: "correct",
        changes: [],
        corrections: ["TikTok followers 17 → 17,300"],
      })),
    }));
    const res = await POST(post({ orgId: "org-1", rows: SHEET, mapping: MAPPING }, "Bearer t0ken"));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(planImport.mock.calls[0][0]).toBe("org-1");
    expect(planImport.mock.calls[0][3]).toHaveLength(1);
    const body = JSON.parse(text);
    expect(body.counts).toMatchObject({ people: 1, correct: 1, create: 0 });
    expect(body.corrections.sample).toEqual(["tiktok @realhandle: TikTok followers 17 → 17,300"]);
    expect(text).not.toMatch(/Secret Person|secret@example\.com/);
  });

  it("POST has no write mode", async () => {
    planImport.mockResolvedValue({ newTags: [], people: [] });
    const res = await POST(post({ orgId: "org-1", rows: SHEET, mapping: MAPPING, mode: "commit" }, "Bearer t0ken"));
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).not.toContain("created");
  });
});
