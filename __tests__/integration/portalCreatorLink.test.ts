/**
 * @jest-environment node
 *
 * lib/portal/creatorLink.ts and the portal surfaces gated on it.
 *
 * The hole: /api/portal/auth/register checks handle uniqueness against
 * CreatorUser and never against the org-side Creator roster, and every portal
 * route bridged the two by handle alone. Registering as "bigcreator" therefore
 * matched that creator's roster row in EVERY org and handed the new account
 * their connected accounts, platform insights, brand reviews, negotiation
 * offers and accrued earnings — and let it revoke their OAuth grants.
 *
 * Registration stays open (agencies roster a creator before that person signs
 * up, and expect them to find their campaigns waiting), so the fix is a second
 * question asked before any of that data is released: has this portal account
 * PROVEN it owns the roster row? One proof: the row names this portal account
 * as its creatorUserId, written only by the person it names (their marketplace
 * join, an accepted invite or connect link, or a signed-in Connect of the
 * platform account carrying this handle).
 *
 * A stored OAuth connection whose handle equals the portal handle used to be a
 * second proof. It proved nothing about who registered the handle: a creator
 * who connected through an agency's connect link never needed a portal
 * account, so whoever registered that handle first got everything above. A
 * contactEmail match is not a proof either: the agency typed or imported that
 * address, and the portal never verified the one it was registered with.
 */
import { findLinkedCreatorsForHandle, isCreatorLinked } from "@/lib/portal/creatorLink";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
    activation: { findMany: jest.fn() },
    post: { findMany: jest.fn() },
  },
}));

import { db } from "@/lib/db";

const mockDb = db as any;

const subject = { handle: "bigcreator", email: "real@creator.com", creatorUserId: "cu-1" };

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
});

describe("findLinkedCreatorsForHandle", () => {
  it("asks only for live rows that name this portal account", async () => {
    mockDb.creator.findMany.mockResolvedValue([{ id: "c1", orgId: "org-1" }]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([{ id: "c1", orgId: "org-1" }]);
    expect(mockDb.creator.findMany).toHaveBeenCalledWith({
      where: { deletedAt: null, creatorUserId: "cu-1" },
      select: { id: true, orgId: true },
    });
  });

  it("does not treat a roster handle match as proof", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    await findLinkedCreatorsForHandle(subject);
    const where = mockDb.creator.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain("bigcreator");
  });

  it("does not treat a stored connection carrying this handle as proof", async () => {
    /* The takeover: a creator connected TikTok through the agency's connect
       link and never registered; someone else registered their handle. */
    mockDb.creator.findMany.mockResolvedValue([]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "c1", handle: "@BigCreator" },
    ]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([]);
    expect(mockDb.creatorSocialAccount.findMany).not.toHaveBeenCalled();
  });

  it("does not link on the roster's contactEmail: that address was never verified", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    await findLinkedCreatorsForHandle(subject);
    const call = mockDb.creator.findMany.mock.calls[0][0];
    expect(call.select).not.toHaveProperty("contactEmail");
    expect(JSON.stringify(call.where)).not.toContain("real@creator.com");
  });

  it("links a row naming this portal account even when its handle is different", async () => {
    /* What an accepted invite or a claimed connect link leaves behind when the
       creator registered under another handle than the one the agency typed. */
    mockDb.creator.findMany.mockResolvedValue([{ id: "c9", orgId: "org-9" }]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([{ id: "c9", orgId: "org-9" }]);
  });

  it("answers nothing without a portal id, without touching the database", async () => {
    expect(await findLinkedCreatorsForHandle({ handle: "bigcreator", email: "" })).toEqual([]);
    expect(await findLinkedCreatorsForHandle({ handle: "bigcreator", creatorUserId: null })).toEqual([]);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });

  it("isCreatorLinked answers for one row", async () => {
    mockDb.creator.findMany.mockResolvedValue([{ id: "c1", orgId: "org-1" }]);
    expect(await isCreatorLinked("c1", subject)).toBe(true);
    expect(await isCreatorLinked("c2", subject)).toBe(false);
  });
});

/* Money is the half of the roster match that has to be earned. The campaign
   still shows up — an agency rosters a creator before they sign up and the
   portal must show them their work — but every amount reads 0 until ownership
   is proven, and /api/portal/payout-requests sizes a withdrawal off exactly
   these numbers. */
/* The earnings code asks for the roster by handle, and the ownership check
   asks for rows naming the portal account; one mock answers both the way the
   database would. */
function rosterOf(rows: Array<{ id: string; orgId: string; creatorUserId: string | null }>) {
  mockDb.creator.findMany.mockImplementation((args: any) =>
    Promise.resolve(
      args?.where && "creatorUserId" in args.where
        ? rows
            .filter((r) => r.creatorUserId === args.where.creatorUserId)
            .map(({ id, orgId }) => ({ id, orgId }))
        : rows,
    ),
  );
}

describe("computeCreatorEarnings — money is gated, the campaign list is not", () => {
  beforeEach(() => {
    rosterOf([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-someone-else" },
    ]);
    mockDb.activation.findMany.mockResolvedValue([
      {
        id: "act-1",
        creatorId: "c1",
        campaign: {
          id: "camp-1",
          title: "Summer Drop",
          publicSlug: "summer-drop",
          currency: "USD",
          ratePerThousand: { TIKTOK: 100 },
          minPayoutMinor: null,
          marketplaceVisibility: "GLOBAL",
          org: { name: "Brand" },
        },
      },
    ]);
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "p1",
        activationId: "act-1",
        postUrl: "https://tiktok.com/@a/video/1",
        platform: "TIKTOK",
        status: "APPROVED",
        viewsCount: 100_000,
        thumbnailUrl: null,
        caption: null,
        createdAt: new Date(),
      },
    ]);
  });

  it("still lists the campaign, but reports 0 for an unproven roster row", async () => {
    const [row] = await computeCreatorEarnings(subject);
    expect(row.campaignId).toBe("camp-1");
    expect(row.submissionCount).toBe(1);
    expect(row.linked).toBe(false);
    expect(row.approvedMinor).toBe(0);
    expect(row.submissions[0].earnedMinor).toBe(0);
    expect(row.submissions[0].potentialMinor).toBe(0);
  });

  it("reports the real accrual once ownership is proven", async () => {
    rosterOf([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-1" },
    ]);
    const [row] = await computeCreatorEarnings(subject);
    expect(row.linked).toBe(true);
    expect(row.approvedMinor).toBe(10_000); // 100k views / 1k * 100 minor
  });
});
