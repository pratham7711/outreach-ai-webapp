/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    plan: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    client: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: () => ({}),
}));
jest.mock("@/lib/audit", () => ({ createAuditActor: () => ({}), logAudit: jest.fn() }));

import { POST as createPlan } from "@/app/api/plans/route";
import { PATCH as updatePlan, DELETE as deletePlan } from "@/app/api/plans/[id]/route";
import { PUT as bulkPlan } from "@/app/api/clients/bulk-plan/route";
import { PATCH as assignPlan } from "@/app/api/clients/[id]/plan/route";
import { PUT as updateFeatures } from "@/app/api/clients/[id]/features/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { navHrefsForRole } from "@/lib/dashboardPolicy";

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: Promise.resolve({ id: "x-1" }) };

function signInAs(role: string) {
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role } });
  (authenticateRequest as jest.Mock).mockResolvedValue({
    orgId: "org-1",
    userId: "u1",
    actorEmail: "a@b.com",
    actorType: "user",
    role,
  });
}

const writes: Array<[string, () => Promise<Response>]> = [
  ["POST /api/plans", () => createPlan(req("POST", { name: "Gold", features: {} }))],
  ["PATCH /api/plans/[id]", () => updatePlan(req("PATCH", { name: "Gold" }), params)],
  ["DELETE /api/plans/[id]", () => deletePlan(req("DELETE"), params)],
  ["PUT /api/clients/bulk-plan", () => bulkPlan(req("PUT", { clientIds: ["c1"], planId: null }))],
  ["PATCH /api/clients/[id]/plan", () => assignPlan(req("PATCH", { planId: null }), params)],
  ["PUT /api/clients/[id]/features", () => updateFeatures(req("PUT", { planId: null }), params)],
];

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;

beforeEach(() => {
  jest.clearAllMocks();
  for (const model of Object.values(mdb)) {
    for (const fn of Object.values(model)) fn.mockResolvedValue({ id: "x-1", orgId: "org-1" });
  }
  mdb.client.findMany.mockResolvedValue([{ id: "c1" }]);
});

describe("client plans and feature overrides are owner/admin only", () => {
  it.each(["MANAGER", "MEMBER", "VIEWER"])("%s is refused every write with 403", async (role) => {
    signInAs(role);
    for (const [, call] of writes) {
      expect((await call()).status).toBe(403);
    }
  });

  it.each(["OWNER", "ADMIN"])("%s gets past the role check", async (role) => {
    signInAs(role);
    for (const [name, call] of writes) {
      expect([name, (await call()).status]).not.toEqual([name, 403]);
    }
  });
});

describe("navHrefsForRole()", () => {
  const hrefs = ["/campaigns", "/creators", "/admin", "/plans"];

  it.each(["OWNER", "ADMIN"])("keeps Feature Access and Plans for %s", (role) => {
    expect(navHrefsForRole(hrefs, role)).toEqual(hrefs);
  });

  it.each(["MANAGER", "MEMBER", "VIEWER", undefined, null])("drops them for %s", (role) => {
    expect(navHrefsForRole(hrefs, role)).toEqual(["/campaigns", "/creators"]);
  });
});
