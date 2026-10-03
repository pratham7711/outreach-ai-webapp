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
 * PROVEN it owns the roster row? Two proofs: the row names this portal account
 * as its creatorUserId (written by the creator's own marketplace join), or an
 * OAuth connection whose platform-resolved handle is this handle. A contactEmail
 * match is not one: the agency typed or imported that address, and the portal
 * never verified the one it was registered with.
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
  it("returns nothing for a bare handle match with no proof", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-someone-else" },
      { id: "c2", orgId: "org-2", creatorUserId: null },
    ]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([]);
  });

  it("links a row that names this portal account as its creator", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-1" },
      { id: "c2", orgId: "org-2", creatorUserId: "cu-2" },
    ]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([{ id: "c1", orgId: "org-1" }]);
  });

  it("does not link on the roster's contactEmail: that address was never verified", async () => {
    mockDb.creator.findMany.mockResolvedValue([{ id: "c1", orgId: "org-1", creatorUserId: null }]);
    await findLinkedCreatorsForHandle(subject);
    expect(mockDb.creator.findMany.mock.calls[0][0].select).not.toHaveProperty("contactEmail");
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([]);
  });

  it("links a row carrying an OAuth connection resolved to this handle", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: null },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "c1", handle: "@BigCreator" },
    ]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([{ id: "c1", orgId: "org-1" }]);
  });

  it("does not link a row whose only connection is somebody else's account", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: null },
    ]);
    mockDb.creatorSocialAccount.findMany.mockResolvedValue([
      { creatorId: "c1", handle: "attackers_own_tiktok" },
    ]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([]);
  });

  it("matches the roster row with or without the leading @, and skips deleted rows", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    await findLinkedCreatorsForHandle(subject);
    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          OR: [{ handle: "bigcreator" }, { handle: "@bigcreator" }, { creatorUserId: "cu-1" }],
        },
      }),
    );
  });

  it("links a row naming this portal account even when its handle is different", async () => {
    /* What an accepted invite or a claimed connect link leaves behind when the
       creator registered under another handle than the one the agency typed. */
    mockDb.creator.findMany.mockResolvedValue([{ id: "c9", orgId: "org-9", creatorUserId: "cu-1" }]);
    expect(await findLinkedCreatorsForHandle(subject)).toEqual([{ id: "c9", orgId: "org-9" }]);
  });

  it("does not search by portal id when there is none", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    await findLinkedCreatorsForHandle({ handle: "bigcreator", email: "" });
    expect(mockDb.creator.findMany.mock.calls[0][0].where.OR).toEqual([
      { handle: "bigcreator" },
      { handle: "@bigcreator" },
    ]);
  });

  it("treats a missing portal id as no proof rather than matching rows with no creatorUserId", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: null },
    ]);
    expect(await findLinkedCreatorsForHandle({ handle: "bigcreator", email: "" })).toEqual([]);
  });

  it("short-circuits on an empty handle without touching the database", async () => {
    expect(await findLinkedCreatorsForHandle({ handle: "@", email: "x@y.com" })).toEqual([]);
    expect(mockDb.creator.findMany).not.toHaveBeenCalled();
  });

  it("isCreatorLinked answers for one row", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-1" },
      { id: "c2", orgId: "org-2", creatorUserId: "cu-2" },
    ]);
    expect(await isCreatorLinked("c1", subject)).toBe(true);
    expect(await isCreatorLinked("c2", subject)).toBe(false);
  });
});

/* Money is the half of the roster match that has to be earned. The campaign
   still shows up — an agency rosters a creator before they sign up and the
   portal must show them their work — but every amount reads 0 until ownership
   is proven, and /api/portal/payout-requests sizes a withdrawal off exactly
   these numbers. */
describe("computeCreatorEarnings — money is gated, the campaign list is not", () => {
  beforeEach(() => {
    mockDb.creator.findMany.mockResolvedValue([
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
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", creatorUserId: "cu-1" },
    ]);
    const [row] = await computeCreatorEarnings(subject);
    expect(row.linked).toBe(true);
    expect(row.approvedMinor).toBe(10_000); // 100k views / 1k * 100 minor
  });
});
