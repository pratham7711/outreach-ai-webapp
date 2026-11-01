/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/entitlements", () => ({
  getOrgEntitlements: jest.fn(),
  hasOrgFeature: (e: { featureMap: Record<string, boolean> } | null, key: string) => e?.featureMap[key] === true,
}));
jest.mock("@/lib/db", () => ({
  db: {
    creatorProspect: { findMany: jest.fn(), updateMany: jest.fn() },
    creatorProspectEvent: { createMany: jest.fn() },
    creator: { findMany: jest.fn() },
    creatorProfileLink: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops)),
  },
}));

import { authenticateRequest } from "@/lib/authenticate";
import { getOrgEntitlements } from "@/lib/entitlements";
import { db } from "@/lib/db";
import { GET } from "@/app/api/creator-finder/route";

const mdb = db as unknown as {
  creatorProspect: { findMany: jest.Mock; updateMany: jest.Mock };
  creatorProspectEvent: { createMany: jest.Mock };
  creator: { findMany: jest.Mock };
};

const at = (hhmm: string) => new Date(`2026-11-01T${hhmm}:00Z`);
const card = (handle: string, platform: "INSTAGRAM" | "YOUTUBE", createdAt: Date) => ({
  id: `p-${handle}`,
  orgId: "org-a",
  platform,
  handle,
  status: "CONTACTED",
  createdAt,
  statusChangedAt: createdAt,
  events: [],
});
/** Roster rows: platform matches answer the first kind of query, portal-linked rows the second. */
function roster(rows: { handle: string; platform: string; portal: boolean; addedAt: Date }[]) {
  mdb.creator.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    rows
      .filter((r) => (where.creatorUserId ? r.portal : r.platform === where.platform))
      .map((r) => ({ id: `c-${r.handle}`, handle: r.handle, addedAt: r.addedAt })),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-a", userId: "u1", role: "OWNER", actorType: "user", actorEmail: null, campaignScope: "ALL" });
  (getOrgEntitlements as jest.Mock).mockResolvedValue({ featureMap: { creator_finder: true } });
});

const board = async () => (await GET(new NextRequest("http://localhost/api/creator-finder"))).json();

describe("the board moves a card to Joined when the creator signs up through the portal", () => {
  it("counts a portal sign-up on any platform, since the portal doesn't ask for one", async () => {
    mdb.creatorProspect.findMany.mockResolvedValue([card("cfjoin_demo", "INSTAGRAM", at("10:00"))]);
    roster([{ handle: "cfjoin_demo", platform: "TIKTOK", portal: true, addedAt: at("10:05") }]);

    const body = await board();

    expect(body.prospects[0].status).toBe("JOINED");
    const portalQuery = mdb.creator.findMany.mock.calls.map((c) => c[0].where).find((w) => w.creatorUserId);
    expect(portalQuery).toMatchObject({ orgId: "org-a", deletedAt: null, creatorUserId: { not: null }, addedAt: { gte: at("10:00") } });
    expect(portalQuery.platform).toBeUndefined();
    expect(mdb.creatorProspectEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ prospectId: "p-cfjoin_demo", fromStatus: "CONTACTED", toStatus: "JOINED", userId: null })],
    });
  });

  it("leaves the card alone for a same-handle creator who was on the roster before the card was made", async () => {
    mdb.creatorProspect.findMany.mockResolvedValue([card("phonkcars", "YOUTUBE", at("10:00"))]);
    roster([{ handle: "@PhonkCars", platform: "TIKTOK", portal: true, addedAt: at("09:00") }]);

    const body = await board();

    expect(body.prospects[0].status).toBe("CONTACTED");
    expect(mdb.creatorProspect.updateMany).not.toHaveBeenCalled();
  });

  it("judges each card by its own creation time", async () => {
    mdb.creatorProspect.findMany.mockResolvedValue([card("early", "INSTAGRAM", at("08:00")), card("late", "INSTAGRAM", at("11:00"))]);
    roster([
      { handle: "early", platform: "TIKTOK", portal: true, addedAt: at("09:00") },
      { handle: "late", platform: "TIKTOK", portal: true, addedAt: at("09:00") },
    ]);

    const body = await board();

    expect(Object.fromEntries(body.prospects.map((p: { handle: string; status: string }) => [p.handle, p.status]))).toEqual({ early: "JOINED", late: "CONTACTED" });
  });

  it("still moves a card on a same-platform roster match, with or without the portal", async () => {
    mdb.creatorProspect.findMany.mockResolvedValue([card("funk_daily", "INSTAGRAM", at("10:00"))]);
    roster([{ handle: "@Funk_Daily", platform: "INSTAGRAM", portal: false, addedAt: at("09:00") }]);

    const body = await board();

    expect(body.prospects[0].status).toBe("JOINED");
  });
});
