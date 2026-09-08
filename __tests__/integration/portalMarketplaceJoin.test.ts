/**
 * @jest-environment node
 *
 * lib/marketplace/join.ts — joinCampaignBySlug.
 *
 * The gate this file exists for: `status` was SELECTED by the campaign lookup
 * from the first commit and never read. A campaign an agency had marked
 * COMPLETE or CANCELLED therefore went on admitting new creators through its
 * still-valid public slug, and each join is an Activation the creator can then
 * submit posts against. /api/portal/proposals already refused anything that was
 * not IN_PROGRESS; join now agrees with it.
 */
import { joinCampaignBySlug } from "@/lib/marketplace/join";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn(), create: jest.fn() },
    creatorUser: { findUnique: jest.fn() },
    activation: { findFirst: jest.fn(), create: jest.fn() },
  },
}));

import { db } from "@/lib/db";

const mockDb = db as any;

const session = {
  id: "sess-1",
  creatorUserId: "cu-1",
  email: "creator@example.com",
  name: "Blessing",
  handle: "blessingjolie",
};

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "camp-1",
  orgId: "org-1",
  publicSlug: "summer-drop",
  status: "IN_PROGRESS",
  deletedAt: null,
  marketplaceVisibility: "GLOBAL",
  inviteCode: null,
  submissionDeadline: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.campaign.findUnique.mockResolvedValue(campaign());
  mockDb.creator.findFirst.mockResolvedValue({ id: "cr-1" });
  mockDb.activation.findFirst.mockResolvedValue(null);
  mockDb.activation.create.mockResolvedValue({ id: "act-new" });
});

describe("joinCampaignBySlug — campaign status", () => {
  it("admits an IN_PROGRESS campaign", async () => {
    const res = await joinCampaignBySlug(session as never, "summer-drop");
    expect(res).toMatchObject({ ok: true, activationId: "act-new", alreadyJoined: false });
    expect(mockDb.activation.create).toHaveBeenCalled();
  });

  it.each(["COMPLETE", "CANCELLED", "DRAFT", "PENDING"])(
    "refuses a %s campaign with 409 and creates nothing",
    async (status) => {
      mockDb.campaign.findUnique.mockResolvedValue(campaign({ status }));
      const res = await joinCampaignBySlug(session as never, "summer-drop");
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect((res as { error: string }).error).toMatch(/not currently open to creators/i);
      expect(mockDb.activation.create).not.toHaveBeenCalled();
      expect(mockDb.creator.create).not.toHaveBeenCalled();
    }
  );

  it("checks visibility before status, so a stranger learns nothing about a PRIVATE campaign", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ status: "CANCELLED", marketplaceVisibility: "PRIVATE" })
    );
    const res = await joinCampaignBySlug(session as never, "summer-drop");
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect((res as { error: string }).error).not.toMatch(/CANCELLED/);
  });

  it("resolves the roster creator through the shared @-insensitive matcher", async () => {
    await joinCampaignBySlug(session as never, "summer-drop");
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId: "org-1",
          deletedAt: null,
          OR: [{ handle: "blessingjolie" }, { handle: "@blessingjolie" }],
        },
      })
    );
  });
});
