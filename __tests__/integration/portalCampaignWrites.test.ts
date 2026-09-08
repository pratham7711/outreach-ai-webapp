/**
 * @jest-environment node
 *
 * POST /api/portal/campaigns/[slug]/submissions and .../draft.
 *
 * These mirror __tests__/integration/portalCampaignDetail.test.ts. The slug is
 * public and durable, so all three routes behind it have to answer the same
 * question — does THIS creator still get to see this campaign — before they say
 * anything about its state. The two write routes did not: they ran their
 * deadline, budget-cap and platform-rate checks first, so a stranger with a
 * stale slug for a PRIVATE campaign was told whether the deadline had passed and
 * whether the budget cap was reached. Neither route could ever be written to
 * without an activation; the leak was in the error text.
 */
import { NextRequest } from "next/server";
import { POST as submit } from "@/app/api/portal/campaigns/[slug]/submissions/route";
import { POST as draft } from "@/app/api/portal/campaigns/[slug]/draft/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn() },
    activation: { findFirst: jest.fn(), update: jest.fn() },
    post: { findFirst: jest.fn(), create: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/marketplace/cap", () => ({ computeCampaignAccrual: jest.fn() }));
jest.mock("@/lib/platforms/fetchPostMetrics", () => ({
  detectPlatform: jest.fn(() => ({ platform: "TIKTOK", id: "999" })),
  fetchPostMetrics: jest.fn(async () => null),
  hasMetricCounts: jest.fn(() => false),
}));
jest.mock("@/lib/sync/syncPost", () => ({
  countsFrom: jest.fn(() => ({ counts: {}, present: [], measuredPatch: {} })),
}));
jest.mock("@/lib/platforms/instagramToken", () => ({ getInstagramAccountForCreator: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ getTikTokTokenForCreator: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";

const mockDb = db as any;
const mockSession = getCreatorSession as jest.Mock;
const mockAccrual = computeCampaignAccrual as jest.Mock;

const SLUG = "summer-drop";

const submitReq = () =>
  submit(
    new NextRequest(`http://localhost/api/portal/campaigns/${SLUG}/submissions`, {
      method: "POST",
      body: JSON.stringify({ postUrl: "https://tiktok.com/@a/video/999" }),
    }),
    { params: Promise.resolve({ slug: SLUG }) }
  );

const draftReq = () =>
  draft(
    new NextRequest(`http://localhost/api/portal/campaigns/${SLUG}/draft`, {
      method: "POST",
      body: JSON.stringify({ draftUrl: "https://drive.example/clip.mp4" }),
    }),
    { params: Promise.resolve({ slug: SLUG }) }
  );

/** Deadline in the PAST, so an ungated route answers 409 and gives the game away. */
const PASSED = new Date("2020-01-01");

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "camp-1",
  orgId: "org-1",
  status: "IN_PROGRESS",
  deletedAt: null,
  ratePerThousand: { TIKTOK: 100 },
  submissionDeadline: null,
  marketplaceVisibility: "GLOBAL",
  marketplaceBudgetCapMinor: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ creatorUserId: "cu-1", handle: "awxyken", name: "Awx", email: "a@b.com" });
  mockDb.campaign.findUnique.mockResolvedValue(campaign());
  mockDb.creator.findFirst.mockResolvedValue(null);
  mockDb.activation.findFirst.mockResolvedValue(null);
  mockDb.post.findFirst.mockResolvedValue(null);
  mockDb.post.create.mockResolvedValue({ id: "post-1" });
  mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "DRAFT_SUBMITTED" });
  mockAccrual.mockResolvedValue({ capReached: false });
});

const joined = () => {
  mockDb.creator.findFirst.mockResolvedValue({ id: "cr-1" });
  mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "AWAITING_DRAFT" });
};

describe.each([
  ["submissions", submitReq, "You must join this campaign before submitting"],
  ["draft", draftReq, "You must join this campaign before submitting a draft"],
] as const)("POST /api/portal/campaigns/[slug]/%s", (_name, call, joinMessage) => {
  it("returns 401 with no creator session", async () => {
    mockSession.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("404s a campaign that reverted to PRIVATE", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Campaign not found");
  });

  it("404s an INVITE_ONLY campaign for a creator who never joined", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "INVITE_ONLY" }));
    expect((await call()).status).toBe(404);
  });

  it("still lets the creator who joined an INVITE_ONLY campaign through the gate", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "INVITE_ONLY" }));
    joined();
    expect((await call()).status).toBe(201);
  });

  /* The disclosure, named. The deadline is the campaign's own state, and a
     stranger with a stale slug learned it from the 409. */
  it("does not report a hidden campaign's deadline to a creator who never joined", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ marketplaceVisibility: "PRIVATE", submissionDeadline: PASSED })
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).not.toMatch(/deadline/i);
  });

  it("still reports the deadline on a GLOBAL campaign, joined or not", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ submissionDeadline: PASSED }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/deadline/i);
  });

  it("still answers 403, not 404, on a GLOBAL campaign the creator has not joined", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(joinMessage);
  });

  it("404s a soft-deleted campaign before it looks at visibility", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ deletedAt: new Date() }));
    expect((await call()).status).toBe(404);
    expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
  });

  /* Scoped to the campaign's org AND matched the way join matches — both
     spellings of the handle. An exact `handle: session.handle` equality here
     403'd "you must join this campaign" at a creator whose roster row is
     stored as "@awxyken", immediately after their join had succeeded. */
  it("resolves the creator inside the campaign's org, never from the request", async () => {
    await call();
    expect(mockDb.creator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: "org-1",
          deletedAt: null,
          OR: [{ handle: "awxyken" }, { handle: "@awxyken" }],
        }),
      })
    );
  });
});

/* A campaign an agency has closed keeps its public slug forever. Until now the
   two write routes never looked at campaign.status, so a COMPLETE or CANCELLED
   campaign went on taking posts and drafts and accruing marketplace liability
   against a budget nobody was watching. /api/portal/proposals already required
   IN_PROGRESS; these now agree with it. */
describe.each([
  ["submissions", submitReq, /not accepting submissions/i],
  ["draft", draftReq, /not accepting drafts/i],
] as const)("POST /api/portal/campaigns/[slug]/%s — closed campaigns", (_name, call, message) => {
  it.each(["COMPLETE", "CANCELLED", "DRAFT", "PENDING"])("409s a %s campaign", async (status) => {
    joined();
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ status }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(message);
    expect(mockDb.post.create).not.toHaveBeenCalled();
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("does not disclose the status of a campaign the caller cannot see", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ status: "CANCELLED", marketplaceVisibility: "PRIVATE" })
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Campaign not found");
  });
});

/* A post URL is public. Scoped to creatorId, the duplicate check let creator B
   paste a URL creator A had already submitted (and been approved on) and accrue
   the same views a second time against the same budget. One post, one claim. */
describe("POST /api/portal/campaigns/[slug]/submissions — one post, one claim", () => {
  it("409s a platformPostId already submitted by ANOTHER creator", async () => {
    joined();
    mockDb.post.findFirst.mockResolvedValue({ id: "post-9", creatorId: "cr-someone-else" });

    const res = await submitReq();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "This post has already been submitted to this campaign"
    );
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it("keeps the first-person wording when the creator re-submits their own post", async () => {
    joined();
    mockDb.post.findFirst.mockResolvedValue({ id: "post-9", creatorId: "cr-1" });

    const res = await submitReq();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("You already submitted this post to this campaign");
  });

  it("looks the post up by campaign, never narrowed to the caller", async () => {
    joined();
    await submitReq();
    expect(mockDb.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "camp-1", platformPostId: "999", platform: "TIKTOK" },
      })
    );
  });
});

/* Cap and platform-rate checks are unique to the submissions route, and both
   describe the campaign to whoever asks. */
describe("POST /api/portal/campaigns/[slug]/submissions — state disclosed only to those who can see the campaign", () => {
  it("does not report a hidden campaign's budget cap", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
    mockAccrual.mockResolvedValue({ capReached: true });

    const res = await submitReq();
    expect(res.status).toBe(404);
    expect((await res.json()).error).not.toMatch(/budget cap/i);
    // Nor was the accrual even computed for a campaign the caller cannot see.
    expect(mockAccrual).not.toHaveBeenCalled();
  });

  it("does not report which platforms a hidden campaign accepts", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ marketplaceVisibility: "PRIVATE", ratePerThousand: { INSTAGRAM: 100 } })
    );

    const res = await submitReq();
    expect(res.status).toBe(404);
    expect((await res.json()).error).not.toMatch(/TIKTOK/);
  });

  it("still reports the budget cap on a GLOBAL campaign", async () => {
    mockAccrual.mockResolvedValue({ capReached: true });
    const res = await submitReq();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/budget cap/i);
  });

  it("creates the post for a joined creator on a GLOBAL campaign", async () => {
    joined();
    const res = await submitReq();
    expect(res.status).toBe(201);
    expect(mockDb.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ campaignId: "camp-1", creatorId: "cr-1", activationId: "act-1" }),
      })
    );
  });
});
