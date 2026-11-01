/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    organization: { findUnique: jest.fn() },
    orgPlanConfig: { update: jest.fn(), create: jest.fn() },
  },
}));

import { GET, POST } from "@/app/api/admin/org-features/route";
import { db } from "@/lib/db";

const mdb = db as unknown as {
  organization: { findUnique: jest.Mock };
  orgPlanConfig: { update: jest.Mock; create: jest.Mock };
};
const saved = process.env.ADMIN_MIGRATE_TOKEN;
const post = (body: unknown, token = "t") =>
  new NextRequest("http://localhost/api/admin/org-features", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ADMIN_MIGRATE_TOKEN = "t";
});
afterAll(() => {
  process.env.ADMIN_MIGRATE_TOKEN = saved;
});

describe("/api/admin/org-features", () => {
  it("is invisible without the admin token and refuses a wrong one", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(new NextRequest("http://localhost/api/admin/org-features?orgId=o"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "t";
    expect((await POST(post({ orgId: "o", feature: "creator_finder", enabled: true }, "wrong"))).status).toBe(401);
    expect(mdb.orgPlanConfig.update).not.toHaveBeenCalled();
  });

  it("only switches grant-only features, never a plan feature", async () => {
    const res = await POST(post({ orgId: "o", feature: "analytics", enabled: true }));
    expect(res.status).toBe(400);
    expect(mdb.orgPlanConfig.update).not.toHaveBeenCalled();
    expect(mdb.orgPlanConfig.create).not.toHaveBeenCalled();
  });

  it("changes one key and keeps every other feature on the row", async () => {
    mdb.organization.findUnique.mockResolvedValue({
      id: "o",
      name: "Org",
      plan: "pro",
      planConfig: { planName: "pro", features: { audit_log: false, songs: true } },
    });
    const res = await POST(post({ orgId: "o", feature: "creator_finder", enabled: true }));
    expect(res.status).toBe(200);
    expect(mdb.orgPlanConfig.update).toHaveBeenCalledWith({
      where: { orgId: "o" },
      data: { features: { audit_log: false, songs: true, creator_finder: true } },
    });
  });

  it("gives an org with no config row one on its own plan, so its limits don't move", async () => {
    mdb.organization.findUnique.mockResolvedValue({ id: "o", name: "Org", plan: "agency", planConfig: null });
    await POST(post({ orgId: "o", feature: "creator_finder", enabled: true }));
    expect(mdb.orgPlanConfig.create).toHaveBeenCalledWith({
      data: { orgId: "o", planName: "agency", features: { creator_finder: true } },
    });
  });

  it("404s for an org that does not exist", async () => {
    mdb.organization.findUnique.mockResolvedValue(null);
    expect((await POST(post({ orgId: "nope", feature: "creator_finder", enabled: true }))).status).toBe(404);
  });
});
