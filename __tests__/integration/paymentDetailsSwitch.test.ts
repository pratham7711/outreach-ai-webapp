/**
 * @jest-environment node
 *
 * Payment details follow the payouts switch (lib/payouts/switch.ts). Off, the
 * creator app is not sent its earnings or bank details and cannot save bank
 * details, and the agency is not sent a creator's paymentInfo and cannot save
 * it. On, all of it comes back. Stored values are never touched by the switch:
 * these routes only stop reading and accepting them.
 */
import { NextRequest } from "next/server";
import { GET as getMe, PATCH as patchMe } from "@/app/api/portal/me/route";
import { GET as getDashboard } from "@/app/api/portal/dashboard/route";
import { GET as getCreator, PATCH as patchCreator } from "@/app/api/creators/[id]/route";

let mockPayoutsOn = false;
jest.mock("@/lib/payouts/switch", () => ({
  get PAYOUTS_ENABLED() {
    return mockPayoutsOn;
  },
}));

jest.mock("@/lib/db", () => {
  const db: any = {
    creatorUser: { findUnique: jest.fn(), update: jest.fn() },
    campaignProposal: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    creator: { findFirst: jest.fn(), update: jest.fn() },
    creatorDetail: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    creatorListItem: { findMany: jest.fn().mockResolvedValue([]) },
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/creators/rosterTables", () => ({ rosterTablesReady: jest.fn().mockResolvedValue(false) }));
jest.mock("@/lib/creatorMetrics", () => ({
  deriveCampaignCounts: jest.fn().mockResolvedValue(new Map()),
  deriveCreatorCampaigns: jest.fn().mockResolvedValue([]),
}));
jest.mock("@/lib/creators/latestReadings", () => ({ latestTrackerReadings: jest.fn().mockResolvedValue(new Map()) }));
jest.mock("@/lib/creators/agencyLookup", () => ({ readThroughOwnAccount: jest.fn().mockResolvedValue(null) }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";

const mockDb = db as any;

const patch = (url: string, body: object) =>
  new NextRequest(url, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const creatorParams = { params: Promise.resolve({ id: "cr-1" }) };

const BANK = {
  bankAccountName: "R2-payouts-off Test",
  bankAccountNumber: "000111",
  bankIFSC: "TEST0000001",
  bankSwift: "TESTXX00",
  bankRoutingNumber: "000000000",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPayoutsOn = false;
  (getCreatorSession as jest.Mock).mockResolvedValue({ creatorUserId: "cu-1", handle: "fake_creator" });
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "OWNER" } });
  mockDb.creatorUser.findUnique.mockResolvedValue({ id: "cu-1", name: "Fake Creator" });
  mockDb.creatorUser.update.mockResolvedValue({ id: "cu-1", name: "Fake Creator" });
  mockDb.creator.findFirst.mockResolvedValue({
    id: "cr-1", orgId: "org-1", name: "Fake", handle: "fake", platform: "TIKTOK",
    followersCount: 0, deletedAt: null, activations: [], posts: [], _count: {},
  });
  mockDb.creator.update.mockResolvedValue({ id: "cr-1", name: "Fake", handle: "fake", platform: "TIKTOK" });
});

const selectOf = (fn: jest.Mock) => fn.mock.calls[0][0].select as Record<string, unknown>;

describe("creator app: GET /api/portal/me", () => {
  it("does not read earnings or the bank account name while payouts are off", async () => {
    expect((await getMe()).status).toBe(200);
    const select = selectOf(mockDb.creatorUser.findUnique);
    expect(select).toEqual(expect.objectContaining({ name: true, handle: true }));
    expect(select).not.toHaveProperty("lifetimeEarnings");
    expect(select).not.toHaveProperty("bankAccountName");
  });

  it("reads them again once payouts are back on", async () => {
    mockPayoutsOn = true;
    await getMe();
    expect(selectOf(mockDb.creatorUser.findUnique)).toEqual(
      expect.objectContaining({ lifetimeEarnings: true, bankAccountName: true }),
    );
  });
});

describe("creator app: PATCH /api/portal/me", () => {
  it.each(Object.keys(BANK))("refuses %s while payouts are off, and writes nothing", async (field) => {
    const res = await patchMe(patch("http://localhost/api/portal/me", { name: "New", [field]: BANK[field as keyof typeof BANK] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/payouts are switched off/);
    expect(mockDb.creatorUser.update).not.toHaveBeenCalled();
  });

  it("refuses a bank field cleared to null too", async () => {
    const res = await patchMe(patch("http://localhost/api/portal/me", { bankAccountNumber: null }));
    expect(res.status).toBe(400);
  });

  it("still saves the profile fields the Account screen sends", async () => {
    const res = await patchMe(patch("http://localhost/api/portal/me", { name: "New", bio: "Hi" }));
    expect(res.status).toBe(200);
    expect(mockDb.creatorUser.update.mock.calls[0][0].data).toEqual({ name: "New", bio: "Hi" });
    expect(selectOf(mockDb.creatorUser.update)).not.toHaveProperty("lifetimeEarnings");
  });

  it("still answers 401 before anything else without a session", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await patchMe(patch("http://localhost/api/portal/me", BANK))).status).toBe(401);
  });

  it("saves bank details once payouts are back on", async () => {
    mockPayoutsOn = true;
    const res = await patchMe(patch("http://localhost/api/portal/me", BANK));
    expect(res.status).toBe(200);
    expect(mockDb.creatorUser.update.mock.calls[0][0].data).toEqual(BANK);
  });
});

describe("creator app: GET /api/portal/dashboard", () => {
  it("leaves out earnings and the bank account while payouts are off", async () => {
    const body = await (await getDashboard()).json();
    const select = selectOf(mockDb.creatorUser.findUnique);
    expect(select).not.toHaveProperty("bankAccountNumber");
    expect(select).not.toHaveProperty("lifetimeEarnings");
    expect(body.stats).not.toHaveProperty("lifetimeEarnings");
    expect(body.stats).toEqual(expect.objectContaining({ totalProposals: 0 }));
  });

  it("sends them once payouts are back on", async () => {
    mockPayoutsOn = true;
    mockDb.creatorUser.findUnique.mockResolvedValue({ name: "Fake Creator", lifetimeEarnings: 1200, bankAccountNumber: "000111" });
    const body = await (await getDashboard()).json();
    expect(selectOf(mockDb.creatorUser.findUnique)).toEqual(
      expect.objectContaining({ bankAccountNumber: true, lifetimeEarnings: true }),
    );
    expect(body.stats.lifetimeEarnings).toBe(1200);
  });
});

describe("agency: /api/creators/[id]", () => {
  it("omits paymentInfo from the creator it reads while payouts are off", async () => {
    expect((await getCreator(new NextRequest("http://localhost/api/creators/cr-1"), creatorParams)).status).toBe(200);
    const args = mockDb.creator.findFirst.mock.calls[0][0];
    expect(args.omit).toEqual({ paymentInfo: true });
    expect(args.where).toEqual(expect.objectContaining({ id: "cr-1", orgId: "org-1" }));
  });

  it("reads it again once payouts are back on", async () => {
    mockPayoutsOn = true;
    await getCreator(new NextRequest("http://localhost/api/creators/cr-1"), creatorParams);
    expect(mockDb.creator.findFirst.mock.calls[0][0].omit).toEqual({ paymentInfo: false });
  });

  it("refuses paymentInfo on PATCH while payouts are off, and writes nothing", async () => {
    const res = await patchCreator(patch("http://localhost/api/creators/cr-1", { name: "New", paymentInfo: "x" }), creatorParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/payouts are switched off/);
    expect(mockDb.creator.update).not.toHaveBeenCalled();
  });

  it("keeps the permission check in front of that refusal", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u-2", orgId: "org-1", role: "VIEWER" } });
    const res = await patchCreator(patch("http://localhost/api/creators/cr-1", { paymentInfo: "x" }), creatorParams);
    expect(res.status).toBe(403);
  });

  it("still saves the fields the edit modal sends, and does not send paymentInfo back", async () => {
    const res = await patchCreator(patch("http://localhost/api/creators/cr-1", { name: "New" }), creatorParams);
    expect(res.status).toBe(200);
    const args = mockDb.creator.update.mock.calls[0][0];
    expect(args.data).toEqual({ name: "New" });
    expect(args.omit).toEqual({ paymentInfo: true });
  });

  it("saves paymentInfo once payouts are back on", async () => {
    mockPayoutsOn = true;
    const res = await patchCreator(patch("http://localhost/api/creators/cr-1", { paymentInfo: "x" }), creatorParams);
    expect(res.status).toBe(200);
    expect(mockDb.creator.update.mock.calls[0][0]).toEqual(
      expect.objectContaining({ data: { paymentInfo: "x" }, omit: { paymentInfo: false } }),
    );
  });
});
