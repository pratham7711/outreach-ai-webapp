/**
 * @jest-environment node
 *
 * GET /api/portal/home and GET /api/portal/campaigns: the creator app's Home
 * and its Joined / Invited tabs. Both answer only for the signed-in creator and
 * carry no money.
 */
jest.mock("@/lib/db", () => ({
  db: { creatorSocialAccount: { count: jest.fn() } },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));
jest.mock("@/lib/portal/myCampaigns", () => ({
  ...jest.requireActual("@/lib/portal/myCampaigns"),
  listJoinedCampaigns: jest.fn(),
  listInvitedCampaigns: jest.fn(),
}));

import { GET as home } from "@/app/api/portal/home/route";
import { GET as campaigns } from "@/app/api/portal/campaigns/route";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { listInvitedCampaigns, listJoinedCampaigns } from "@/lib/portal/myCampaigns";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const mockSession = getCreatorSession as jest.Mock;
const session = { id: "s-1", creatorUserId: "cu-1", email: "c@example.test", name: "Fake Creator", handle: "fake_creator_one" };

const joinedRow = {
  campaignId: "camp-1",
  href: "/portal/campaigns/camp-1",
  title: "Autumn Drop",
  orgName: "Agency One",
  campaignStatus: "IN_PROGRESS",
  activationStatus: "ACCEPTED",
  actionable: true,
  postsSubmitted: 0,
  feedback: null,
  deliverableDueDate: null,
  submissionDeadline: null,
  next: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue(session);
  (listJoinedCampaigns as jest.Mock).mockResolvedValue([joinedRow]);
  (listInvitedCampaigns as jest.Mock).mockResolvedValue([]);
  (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([{ id: "cr-1", orgId: "org-1" }]);
  mdb.creatorSocialAccount.count.mockResolvedValue(0);
});

describe("GET /api/portal/home", () => {
  it("401s without a creator session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await home()).status).toBe(401);
    expect(listJoinedCampaigns).not.toHaveBeenCalled();
  });

  it("puts Connect an account first while nothing is connected", async () => {
    const body = await (await home()).json();
    expect(body.todo.map((t: { kind: string }) => t.kind)).toEqual(["connect", "post_due"]);
    expect(body.connectedAccounts).toBe(0);
    expect(body.campaigns).toHaveLength(1);
  });

  it("counts only accounts the creator authorised, never an agency's hand-typed row", async () => {
    mdb.creatorSocialAccount.count.mockResolvedValue(2);
    const body = await (await home()).json();
    expect(body.todo.map((t: { kind: string }) => t.kind)).toEqual(["post_due"]);
    expect(mdb.creatorSocialAccount.count).toHaveBeenCalledWith({
      where: {
        AND: [
          { OR: [{ creatorId: { in: ["cr-1"] } }, { creatorUserId: "cu-1" }] },
          { OR: [{ origin: null }, { origin: { not: "manual" } }] },
        ],
      },
    });
  });

  it("counts by login alone when no roster row is proven", async () => {
    (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([]);
    await home();
    expect(mdb.creatorSocialAccount.count.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ creatorUserId: "cu-1" }],
    });
  });

  it("leaves joined campaigns out of the invited list", async () => {
    await home();
    expect(listInvitedCampaigns).toHaveBeenCalledWith(session, new Set(["camp-1"]));
  });

  it("carries no money", async () => {
    const text = JSON.stringify(await (await home()).json());
    expect(text).not.toMatch(/earn|payout|rate|Minor/i);
  });
});

describe("GET /api/portal/campaigns", () => {
  it("401s without a creator session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await campaigns()).status).toBe(401);
  });

  it("answers the Joined and Invited tabs", async () => {
    (listInvitedCampaigns as jest.Mock).mockResolvedValue([
      { campaignId: "camp-9", href: "/invite/cinvtoken000000000000001", title: "Winter", orgName: "Agency One", submissionDeadline: null, invitedAt: "2026-09-30T00:00:00.000Z" },
    ]);
    const body = await (await campaigns()).json();
    expect(body.joined.map((c: { campaignId: string }) => c.campaignId)).toEqual(["camp-1"]);
    expect(body.invited.map((c: { href: string }) => c.href)).toEqual(["/invite/cinvtoken000000000000001"]);
  });

  it("500s without leaking the error", async () => {
    (listJoinedCampaigns as jest.Mock).mockRejectedValue(new Error("db down: secret detail"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await campaigns();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret/);
    spy.mockRestore();
  });
});
