/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/settings/taxonomy/[kind]/route";
import { PATCH, DELETE } from "@/app/api/settings/taxonomy/[kind]/[id]/route";

jest.mock("@/lib/db", () => {
  const delegate = () => ({
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  });
  return {
    db: {
      creatorTagDef: delegate(),
      creatorFlagDef: delegate(),
      campaignTagDef: delegate(),
      deliverableTypeDef: delegate(),
      campaignStatusDef: delegate(),
      activationStatusDef: delegate(),
      // The campaign-status paths re-name campaigns left without one.
      campaign: { updateMany: jest.fn() },
    },
  };
});

/* Mocked wholesale rather than with requireActual: the real module imports
   lib/auth, which pulls next-auth's ESM build into a CJS jest runtime. */
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
  getAuditActor: (r: any) => ({
    userId: r.userId ?? undefined,
    actorType: r.actorType,
    actorEmail: r.actorEmail ?? undefined,
  }),
}));

jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { REFERENCE_DEFAULTS } from "@/lib/taxonomy";

const mockDb = db as any;
const mockAuth = authenticateRequest as jest.Mock;

function req(method = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/settings/taxonomy/campaign-statuses", {
    method,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
}

const kindParams = (kind = "campaign-statuses") => ({ params: Promise.resolve({ kind }) });
const idParams = (kind = "campaign-statuses", id = "row-1") => ({
  params: Promise.resolve({ kind, id }),
});

function asUser(role: string) {
  mockAuth.mockResolvedValue({
    orgId: "org-1",
    userId: "u1",
    actorEmail: "a@b.com",
    actorType: "user",
    role,
    campaignScope: "ALL",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  asUser("ADMIN");
  for (const d of [
    mockDb.creatorTagDef,
    mockDb.creatorFlagDef,
    mockDb.campaignTagDef,
    mockDb.deliverableTypeDef,
    mockDb.campaignStatusDef,
    mockDb.activationStatusDef,
  ]) {
    d.findMany.mockResolvedValue([]);
    d.findFirst.mockResolvedValue(null);
    d.create.mockResolvedValue({ id: "new-1", name: "New" });
    d.createMany.mockResolvedValue({ count: 0 });
    d.count.mockResolvedValue(1);
    d.update.mockResolvedValue({ id: "row-1", name: "Renamed" });
    d.delete.mockResolvedValue({});
  }
  mockDb.campaign.updateMany.mockResolvedValue({ count: 0 });
});

/* The two ways a campaign loses its named status, neither of which the
   campaign routes can see: the org acquires its first statuses (every
   campaign written before that carries none), and a status is deleted, which
   the ON DELETE SET NULL foreign key applies to every campaign pointing at
   it. Verified against prod's catalog: Campaign_statusDefId_fkey is SET NULL. */
describe("campaigns are re-named when the org's status list changes", () => {
  const DEFS = [
    { id: "def-pending", name: "Pending", bucket: "PENDING", sortOrder: 0 },
    { id: "def-active", name: "In-Progress", bucket: "IN_PROGRESS", sortOrder: 1 },
    { id: "def-paused", name: "Paused", bucket: "CANCELLED", sortOrder: 6 },
    { id: "def-canceled", name: "Canceled", bucket: "CANCELLED", sortOrder: 7 },
  ];

  const backfilled = () =>
    mockDb.campaign.updateMany.mock.calls.map(([args]: any[]) => [
      args.where.status,
      args.data.statusDefId,
    ]);

  it("names the existing campaigns when the starter set is seeded", async () => {
    mockDb.campaignStatusDef.count.mockResolvedValue(0);
    mockDb.campaignStatusDef.createMany.mockResolvedValue({ count: 8 });
    mockDb.campaignStatusDef.findMany.mockResolvedValue(DEFS);

    await GET(req(), kindParams());

    expect(backfilled()).toEqual(
      expect.arrayContaining([
        ["PENDING", "def-pending"],
        ["IN_PROGRESS", "def-active"],
        ["CANCELLED", "def-canceled"],
      ])
    );
  });

  // Only rows that are already unnamed, and only this org's.
  it("touches only this org's campaigns that carry no status", async () => {
    mockDb.campaignStatusDef.count.mockResolvedValue(0);
    mockDb.campaignStatusDef.createMany.mockResolvedValue({ count: 8 });
    mockDb.campaignStatusDef.findMany.mockResolvedValue(DEFS);

    await GET(req(), kindParams());

    for (const [args] of mockDb.campaign.updateMany.mock.calls) {
      expect(args.where).toEqual(
        expect.objectContaining({ orgId: "org-1", statusDefId: null })
      );
    }
  });

  it("does not backfill when the list was already seeded", async () => {
    mockDb.campaignStatusDef.count.mockResolvedValue(8);

    await GET(req(), kindParams());

    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });

  it("names them when the first status is added by hand", async () => {
    mockDb.campaignStatusDef.create.mockResolvedValue({ id: "def-active", name: "In-Progress" });
    mockDb.campaignStatusDef.findMany.mockResolvedValue(DEFS);

    const res = await POST(req("POST", { name: "In-Progress", bucket: "IN_PROGRESS" }), kindParams());

    expect(res.status).toBe(201);
    expect(backfilled()).toContainEqual(["IN_PROGRESS", "def-active"]);
  });

  // The delete has already nulled them by the time the route resumes.
  it("re-names the campaigns a deleted status left pointing at nothing", async () => {
    mockDb.campaignStatusDef.findFirst.mockResolvedValue({ id: "row-1", name: "Paid" });
    mockDb.campaignStatusDef.findMany.mockResolvedValue(DEFS);

    const res = await DELETE(req("DELETE"), idParams());

    expect(res.status).toBe(200);
    expect(mockDb.campaignStatusDef.delete).toHaveBeenCalledWith({ where: { id: "row-1" } });
    expect(backfilled()).toContainEqual(["IN_PROGRESS", "def-active"]);
  });

  // Activations have the same nullable pointer, but naming them is not this
  // change; the campaign-only guard is what keeps that true.
  it("leaves the activation-status list alone", async () => {
    mockDb.activationStatusDef.findFirst.mockResolvedValue({ id: "row-1", name: "Invited" });

    await DELETE(req("DELETE"), idParams("activation-statuses"));
    await POST(
      req("POST", { name: "Invited", bucket: "AWAITING_DRAFT" }),
      kindParams("activation-statuses")
    );

    expect(mockDb.campaign.updateMany).not.toHaveBeenCalled();
  });
});

describe("taxonomy writes are admin-only", () => {
  it.each(["MEMBER", "VIEWER", "MANAGER"])("refuses POST for %s", async (role) => {
    asUser(role);
    const res = await POST(req("POST", { name: "X", bucket: "PENDING" }), kindParams());
    expect(res.status).toBe(403);
    expect(mockDb.campaignStatusDef.create).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "VIEWER", "MANAGER"])("refuses PATCH for %s", async (role) => {
    asUser(role);
    const res = await PATCH(req("PATCH", { name: "X" }), idParams());
    expect(res.status).toBe(403);
    expect(mockDb.campaignStatusDef.update).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "VIEWER", "MANAGER"])("refuses DELETE for %s", async (role) => {
    asUser(role);
    const res = await DELETE(req("DELETE"), idParams());
    expect(res.status).toBe(403);
    expect(mockDb.campaignStatusDef.delete).not.toHaveBeenCalled();
  });

  it("returns 401 with no session at all", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(req("POST", { name: "X", bucket: "PENDING" }), kindParams());
    expect(res.status).toBe(401);
  });

  it.each(["ADMIN", "OWNER"])("allows POST for %s", async (role) => {
    asUser(role);
    const res = await POST(req("POST", { name: "X", bucket: "PENDING" }), kindParams());
    expect(res.status).toBe(201);
    expect(mockDb.campaignStatusDef.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orgId: "org-1" }) })
    );
  });

  it("still lets a MEMBER read the list — the pickers need it", async () => {
    asUser("MEMBER");
    const res = await GET(req(), kindParams());
    expect(res.status).toBe(200);
    expect(mockDb.campaignStatusDef.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org-1" } })
    );
  });
});

describe("reference defaults are seeded on first read", () => {
  it("seeds an org whose list is empty, scoped to that org", async () => {
    mockDb.campaignStatusDef.count.mockResolvedValue(0);
    mockDb.campaignStatusDef.createMany.mockResolvedValue({
      count: REFERENCE_DEFAULTS.campaignStatuses.length,
    });

    const res = await GET(req(), kindParams());
    expect(res.status).toBe(200);

    expect(mockDb.campaignStatusDef.createMany).toHaveBeenCalledTimes(1);
    const arg = mockDb.campaignStatusDef.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(REFERENCE_DEFAULTS.campaignStatuses.length);
    for (const row of arg.data) expect(row.orgId).toBe("org-1");
    expect(arg.data[0]).toEqual(expect.objectContaining({ name: "Pending", bucket: "PENDING" }));
  });

  it("does not seed a list that already has rows", async () => {
    mockDb.campaignStatusDef.count.mockResolvedValue(3);
    await GET(req(), kindParams());
    expect(mockDb.campaignStatusDef.createMany).not.toHaveBeenCalled();
  });

  it("has no starter set for tags, so it never counts or writes", async () => {
    await GET(req(), kindParams("creator-tags"));
    expect(mockDb.creatorTagDef.count).not.toHaveBeenCalled();
    expect(mockDb.creatorTagDef.createMany).not.toHaveBeenCalled();
  });

  it("still answers the read when seeding throws", async () => {
    mockDb.campaignStatusDef.count.mockRejectedValue(new Error("boom"));
    const res = await GET(req(), kindParams());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
