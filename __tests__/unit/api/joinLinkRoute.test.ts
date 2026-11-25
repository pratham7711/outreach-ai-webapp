/**
 * @jest-environment node
 *
 * The roster's "Join link" dialog makes the agency's first link itself, so
 * GET has to say whether a missing link was never made (make it) or was
 * turned off on purpose (leave it off).
 */
jest.mock("@/lib/db", () => ({
  db: {
    orgJoinLink: { findFirst: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
  },
}));
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(async () => ({ actorType: "user", role: "OWNER", orgId: "org1", userId: "u1" })),
  getAuditActor: () => ({}),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }));

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { DELETE, GET } from "@/app/api/join-link/route";
import { joinLinkTurnedOff } from "@/lib/creators/joinLink";

const mockDb = db as unknown as {
  orgJoinLink: { findFirst: jest.Mock; count: jest.Mock; updateMany: jest.Mock };
};

const req = () => new NextRequest("http://localhost:3009/api/join-link");

beforeEach(() => jest.clearAllMocks());

describe("joinLinkTurnedOff", () => {
  it("is false when the org never had a link, so the dialog makes one", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue(null);
    mockDb.orgJoinLink.count.mockResolvedValue(0);
    await expect(joinLinkTurnedOff("org1")).resolves.toBe(false);
  });

  it("is true when every link the org had was turned off", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue(null);
    mockDb.orgJoinLink.count.mockResolvedValue(2);
    await expect(joinLinkTurnedOff("org1")).resolves.toBe(true);
  });

  it("is false while a link is live", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue({ id: "jl1" });
    await expect(joinLinkTurnedOff("org1")).resolves.toBe(false);
    expect(mockDb.orgJoinLink.count).not.toHaveBeenCalled();
  });

  it("is false when the table is not there yet", async () => {
    mockDb.orgJoinLink.findFirst.mockRejectedValue(Object.assign(new Error("OrgJoinLink missing"), { code: "P2021" }));
    await expect(joinLinkTurnedOff("org1")).resolves.toBe(false);
  });
});

describe("GET /api/join-link", () => {
  it("returns turnedOff: false for an org that never made a link", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue(null);
    mockDb.orgJoinLink.count.mockResolvedValue(0);
    const res = await GET(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ active: false, turnedOff: false });
  });

  it("returns turnedOff: true after the link was switched off", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue(null);
    mockDb.orgJoinLink.count.mockResolvedValue(1);
    await expect((await GET(req())).json()).resolves.toEqual({ active: false, turnedOff: true });
  });

  it("returns the live link with its full URL", async () => {
    mockDb.orgJoinLink.findFirst.mockResolvedValue({
      id: "jl1",
      orgId: "org1",
      code: "abcdefgh2345",
      createdAt: new Date("2026-11-25T00:00:00Z"),
      joinedCount: 0,
      lastJoinedAt: null,
    });
    const data = await (await GET(req())).json();
    expect(data.active).toBe(true);
    expect(data.url).toMatch(/\/join\/abcdefgh2345$/);
  });
});

describe("DELETE /api/join-link", () => {
  it("reports the link as turned off, so the dialog does not remake it", async () => {
    mockDb.orgJoinLink.updateMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(new NextRequest("http://localhost:3009/api/join-link", { method: "DELETE" }));
    await expect(res.json()).resolves.toEqual({ active: false, turnedOff: true });
  });
});
