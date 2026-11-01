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
    creator: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    activation: { findFirst: jest.fn(), update: jest.fn() },
    post: { findFirst: jest.fn(), create: jest.fn(), count: jest.fn() },
    campaignRules: { findFirst: jest.fn() },
    postAnnotation: { upsert: jest.fn() },
    creatorTrackerSnapshot: { findFirst: jest.fn() },
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
  // The fetch above answers nothing, so there is no reading to accept.
  measuredForNewPost: jest.fn(() => null),
}));
jest.mock("@/lib/platforms/instagramToken", () => ({ getInstagramAccountForCreator: jest.fn() }));
jest.mock("@/lib/platforms/tiktokToken", () => ({ getTikTokTokenForCreator: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { computeCampaignAccrual } from "@/lib/marketplace/cap";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";

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
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.activation.findFirst.mockResolvedValue(null);
  mockDb.post.findFirst.mockResolvedValue(null);
  mockDb.post.create.mockResolvedValue({ id: "post-1" });
  mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "DRAFT_SUBMITTED" });
  mockAccrual.mockResolvedValue({ capReached: false });
  mockDb.campaignRules.findFirst.mockResolvedValue(null);
  mockDb.post.count.mockResolvedValue(0);
  mockDb.postAnnotation.upsert.mockResolvedValue({});
  mockDb.creator.findUnique.mockResolvedValue(null);
  mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
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

/* An agency's private campaign now reaches the creator app through an invite.
   Its creators act through the roster row linked to their login, never through
   a handle someone else could register (F10). */
describe.each([
  ["submissions", submitReq],
  ["draft", draftReq],
] as const)("POST /api/portal/campaigns/[slug]/%s — private campaigns", (_name, call) => {
  const linkedActivation = { id: "act-1", creatorId: "cr-linked", status: "AWAITING_DRAFT" };

  it("accepts work from the login the roster row is linked to", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ marketplaceVisibility: "PRIVATE", ratePerThousand: null })
    );
    mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
    mockDb.activation.findFirst.mockResolvedValue(linkedActivation);

    const res = await call();
    expect(res.status).toBe(201);
    expect(mockDb.creator.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ orgId: "org-1", creatorUserId: "cu-1" }),
      })
    );
  });

  it("404s a login that only shares the handle of a creator on it", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
    mockDb.creator.findMany.mockResolvedValue([]);
    joined();

    const res = await call();
    expect(res.status).toBe(404);
    expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
    expect(mockDb.post.create).not.toHaveBeenCalled();
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/portal/campaigns/[slug]/submissions — platform rates", () => {
  /* A private campaign carries no per-view rate: its creators are on a fee.
     The rate check is for the marketplace, where an unpriced platform is one
     the campaign does not take. */
  it("takes a post on a private campaign with no rate for its platform", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(
      campaign({ marketplaceVisibility: "PRIVATE", ratePerThousand: { INSTAGRAM: 100 } })
    );
    mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", creatorId: "cr-linked", status: "ACCEPTED" });

    expect((await submitReq()).status).toBe(201);
  });

  it("still refuses an unpriced platform on a marketplace campaign", async () => {
    mockDb.campaign.findUnique.mockResolvedValue(campaign({ ratePerThousand: { INSTAGRAM: 100 } }));
    joined();
    const res = await submitReq();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/TIKTOK/);
  });
});

/* The agency's submission rules and launch date (lib/campaigns/rules). Only a
   measured failure refuses a post; what we could not measure goes through
   with a note for the agency, which reviews every portal post anyway. */
describe("POST /api/portal/campaigns/[slug]/submissions — campaign rules", () => {
  const rulesRow = (over: Record<string, unknown> = {}) => ({
    dos: [],
    donts: [],
    examplePostUrls: [],
    minFollowers: null,
    requiredHashtags: [],
    requiredMentions: [],
    maxPostsPerAccount: null,
    launchAt: null,
    viewGoal: null,
    ...over,
  });
  const submitWith = (body: Record<string, unknown>) =>
    submit(
      new NextRequest(`http://localhost/api/portal/campaigns/${SLUG}/submissions`, {
        method: "POST",
        body: JSON.stringify({ postUrl: "https://tiktok.com/@a/video/999", ...body }),
      }),
      { params: Promise.resolve({ slug: SLUG }) }
    );
  const mockFetch = fetchPostMetrics as jest.Mock;

  it("refuses posts until the launch date", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ launchAt: new Date(Date.now() + 3 * 86_400_000) }));
    const res = await submitReq();
    expect(res.status).toBe(409);
    // The portal's "Nov 1" style, not "1 Nov 2026".
    expect((await res.json()).error).toMatch(/^This campaign opens for posts on [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it("takes posts once the launch date has passed", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ launchAt: new Date(Date.now() - 86_400_000) }));
    expect((await submitReq()).status).toBe(201);
  });

  it("refuses a creator already at the posts-per-account limit, counting live posts on that platform", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ maxPostsPerAccount: 1 }));
    mockDb.post.count.mockResolvedValue(1);
    const res = await submitReq();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Up to 1 post per account/);
    expect(mockDb.post.count.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ campaignId: "camp-1", creatorId: "cr-1", platform: "TIKTOK", removedAt: null })
    );
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it("refuses a measured follower count below the minimum", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ minFollowers: 10_000 }));
    mockDb.creator.findUnique.mockResolvedValue({ platform: "TIKTOK", followersCount: 500 });
    const res = await submitReq();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Needs 10,000 followers/);
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it("lets an unmeasured follower count through and notes it for the agency", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ minFollowers: 10_000 }));
    mockDb.creator.findUnique.mockResolvedValue({ platform: "TIKTOK", followersCount: 0 });
    const res = await submitReq();
    expect(res.status).toBe(201);
    expect(mockDb.postAnnotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ postId: "post-1", ruleNotes: ["Followers not measured"] }) })
    );
  });

  it("refuses a caption that was read and lacks a required hashtag", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ requiredHashtags: ["#summerdrop"] }));
    mockFetch.mockResolvedValueOnce({ caption: "new video #fyp" });
    const res = await submitReq();
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Missing from the caption: #summerdrop/);
    expect(mockDb.post.create).not.toHaveBeenCalled();
  });

  it("accepts a caption carrying the hashtag in any case", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ requiredHashtags: ["#summerdrop"] }));
    mockFetch.mockResolvedValueOnce({ caption: "new video #SummerDrop" });
    expect((await submitReq()).status).toBe(201);
    expect(mockDb.postAnnotation.upsert).not.toHaveBeenCalled();
  });

  it("lets a caption it could not read through with a note", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ requiredMentions: ["@brand"] }));
    const res = await submitReq();
    expect(res.status).toBe(201);
    expect(mockDb.postAnnotation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ ruleNotes: ["Caption not read"] }) })
    );
  });

  it("stores a boost code given with the post", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ allowBoostCodes: true }));
    const res = await submitWith({ boostCode: "  #SPARK123  ", boostCodeExpiresAt: "2026-12-01" });
    expect(res.status).toBe(201);
    const arg = mockDb.postAnnotation.upsert.mock.calls[0][0];
    expect(arg.create.boostCode).toBe("#SPARK123");
    expect(arg.create.boostCodeExpiresAt).toEqual(new Date("2026-12-01"));
  });

  it("refuses a boost code, creating nothing, while the campaign has boost codes off", async () => {
    joined();
    const res = await submitWith({ boostCode: "SPARK1" });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("boost_codes_off");
    expect(mockDb.post.create).not.toHaveBeenCalled();
    expect(mockDb.postAnnotation.upsert).not.toHaveBeenCalled();
  });

  it("400s an expiry that is not a date", async () => {
    joined();
    expect((await submitWith({ boostCode: "X", boostCodeExpiresAt: "soon" })).status).toBe(400);
  });

  it("behaves as before when the rules table does not exist yet", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockRejectedValue(Object.assign(new Error('relation "CampaignRules" does not exist'), { code: "P2021" }));
    mockDb.postAnnotation.upsert.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    expect((await submitWith({})).status).toBe(201);
    /* No table means boost codes are off, so the portal never offers the field. */
    expect((await submitWith({ boostCode: "X" })).status).toBe(403);
  });

  it("does not turn a created post into a 500 when the note fails", async () => {
    joined();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ allowBoostCodes: true }));
    mockDb.postAnnotation.upsert.mockRejectedValue(new Error("connection reset"));
    expect((await submitWith({ boostCode: "X" })).status).toBe(201);
  });
});
