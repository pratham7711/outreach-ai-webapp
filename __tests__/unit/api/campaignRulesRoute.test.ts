/**
 * @jest-environment node
 *
 * /api/campaigns/[id]/rules: the rules as a whole (GET/PUT) and the
 * per-campaign feature switches (PATCH: boost codes, exclusions), which are
 * off by default and which a rules save never changes.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    campaignRules: { findFirst: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { GET, PATCH, PUT } from "@/app/api/campaigns/[id]/rules/route";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { EMPTY_RULES } from "@/lib/campaigns/rulesShape";

const mdb = db as unknown as {
  campaign: { findFirst: jest.Mock };
  campaignRules: { findFirst: jest.Mock; upsert: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock };
};

const ctx = { params: Promise.resolve({ id: "camp-9" }) };
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/campaigns/camp-9/rules", { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/* One row as the database holds it; each read selects its own columns. */
let row: Record<string, unknown> | null;
const fullRow = (over: Record<string, unknown> = {}) => ({ ...EMPTY_RULES, launchAt: null, allowExclusions: false, allowBoostCodes: false, campaignId: "camp-9", ...over });

beforeEach(() => {
  jest.clearAllMocks();
  row = null;
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "OWNER", email: "o@example.com" } });
  mdb.campaign.findFirst.mockResolvedValue({ id: "camp-9", orgId: "org-1", title: "C" });
  mdb.campaignRules.findFirst.mockImplementation(async () => row);
  mdb.campaignRules.upsert.mockResolvedValue({});
  mdb.campaignRules.updateMany.mockResolvedValue({ count: 1 });
  mdb.campaignRules.deleteMany.mockResolvedValue({ count: 0 });
});

describe("GET", () => {
  it("answers every switch off for a campaign with no row", async () => {
    const res = await GET(req("GET"), ctx);
    const body = await res.json();
    expect(body.allowExclusions).toBe(false);
    expect(body.allowBoostCodes).toBe(false);
    expect(body.rules).toEqual(EMPTY_RULES);
  });

  it("reads a row holding only a switch as no rules, that switch on", async () => {
    row = fullRow({ allowBoostCodes: true });
    const body = await (await GET(req("GET"), ctx)).json();
    expect(body).toEqual({ rules: EMPTY_RULES, allowExclusions: false, allowBoostCodes: true, ready: true, canEdit: true });
  });

  it("answers off and not ready while the table is missing", async () => {
    mdb.campaignRules.findFirst.mockRejectedValue(Object.assign(new Error("The table `public.CampaignRules` does not exist"), { code: "P2021" }));
    const body = await (await GET(req("GET"), ctx)).json();
    expect(body).toEqual({ rules: EMPTY_RULES, allowExclusions: false, allowBoostCodes: false, ready: false, canEdit: true });
  });

  it("tells a VIEWER it can read but not change", async () => {
    (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    const body = await (await GET(req("GET"), ctx)).json();
    expect(body.canEdit).toBe(false);
  });
});

describe("PATCH (exclusions switch)", () => {
  it("switches on with an upsert that touches nothing else, and audits the change", async () => {
    const res = await PATCH(req("PATCH", { allowExclusions: true }), ctx);
    expect(res.status).toBe(200);
    expect(mdb.campaignRules.upsert).toHaveBeenCalledWith({
      where: { campaignId: "camp-9" },
      create: { campaignId: "camp-9", orgId: "org-1", allowExclusions: true },
      update: { allowExclusions: true },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "campaign.exclusions.update", before: { allowExclusions: false }, after: { allowExclusions: true } })
    );
  });

  it("switches boost codes on alone, audited under its own action", async () => {
    row = fullRow({ allowExclusions: true });
    const res = await PATCH(req("PATCH", { allowBoostCodes: true }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allowExclusions: true, allowBoostCodes: true });
    expect(mdb.campaignRules.upsert).toHaveBeenCalledWith({
      where: { campaignId: "camp-9" },
      create: { campaignId: "camp-9", orgId: "org-1", allowBoostCodes: true },
      update: { allowBoostCodes: true },
    });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "campaign.boost_codes.update" }));
  });

  it("switches off without creating a row", async () => {
    row = fullRow({ allowExclusions: true });
    expect((await PATCH(req("PATCH", { allowExclusions: false }), ctx)).status).toBe(200);
    expect(mdb.campaignRules.upsert).not.toHaveBeenCalled();
    expect(mdb.campaignRules.updateMany).toHaveBeenCalledWith({ where: { campaignId: "camp-9", orgId: "org-1" }, data: { allowExclusions: false } });
  });

  it("writes no audit line when nothing changed", async () => {
    await PATCH(req("PATCH", { allowExclusions: false }), ctx);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("refuses anything but a boolean", async () => {
    for (const v of ["true", 1, null, undefined]) {
      expect((await PATCH(req("PATCH", { allowExclusions: v }), ctx)).status).toBe(400);
      expect((await PATCH(req("PATCH", { allowBoostCodes: v }), ctx)).status).toBe(400);
    }
    expect((await PATCH(req("PATCH", { allowBoostCodes: true, allowExclusions: "yes" }), ctx)).status).toBe(400);
    expect(mdb.campaignRules.upsert).not.toHaveBeenCalled();
  });

  it("refuses a VIEWER and a campaign outside the org or scope", async () => {
    (auth as jest.Mock).mockResolvedValueOnce({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    expect((await PATCH(req("PATCH", { allowExclusions: true }), ctx)).status).toBe(403);
    mdb.campaign.findFirst.mockResolvedValueOnce(null);
    expect((await PATCH(req("PATCH", { allowExclusions: true }), ctx)).status).toBe(404);
    expect(mdb.campaignRules.upsert).not.toHaveBeenCalled();
  });

  it("answers 503 while the table is missing", async () => {
    mdb.campaignRules.upsert.mockRejectedValueOnce(Object.assign(new Error("does not exist"), { code: "P2021" }));
    expect((await PATCH(req("PATCH", { allowExclusions: true }), ctx)).status).toBe(503);
  });
});

describe("PUT (rules) keeps the switch", () => {
  it("clearing every rule keeps a row that holds the switch, emptied, and deletes one that does not", async () => {
    row = fullRow({ allowExclusions: true, dos: ["Hook first"] });
    expect((await PUT(req("PUT", EMPTY_RULES), ctx)).status).toBe(200);
    expect(mdb.campaignRules.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "camp-9", orgId: "org-1", allowBoostCodes: false, allowExclusions: false } });
    const cleared = mdb.campaignRules.updateMany.mock.calls[0][0];
    expect(cleared.where).toEqual({ campaignId: "camp-9", orgId: "org-1" });
    expect(cleared.data).not.toHaveProperty("allowExclusions");
    expect(cleared.data).not.toHaveProperty("allowBoostCodes");
    expect(cleared.data).toMatchObject({ dos: [], launchAt: null, viewGoal: null });
  });

  it("saving rules never writes the switch", async () => {
    expect((await PUT(req("PUT", { ...EMPTY_RULES, dos: ["Hook first"] }), ctx)).status).toBe(200);
    const { create, update } = mdb.campaignRules.upsert.mock.calls[0][0];
    for (const key of ["allowExclusions", "allowBoostCodes"]) {
      expect(update).not.toHaveProperty(key);
      expect(create).not.toHaveProperty(key);
    }
  });
});
