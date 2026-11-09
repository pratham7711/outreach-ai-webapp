/**
 * @jest-environment node
 *
 * GET /api/portal/campaigns/[slug] serves a campaign's guidelines, per-platform
 * rates, deadline and internal id to a logged-in portal creator. The slug is
 * public and durable, so the route has to decide who still gets to see the
 * campaign behind it — not merely that the caller is some creator.
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/portal/campaigns/[slug]/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    activation: { findFirst: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    post: { findMany: jest.fn(), count: jest.fn() },
    campaignRules: { findFirst: jest.fn() },
    postAnnotation: { findMany: jest.fn() },
    creatorTrackerSnapshot: { findFirst: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockDb = db as any;
const mockSession = getCreatorSession as jest.Mock;

const call = (slug = "summer-drop") =>
  GET(new NextRequest(`http://localhost/api/portal/campaigns/${slug}`), {
    params: Promise.resolve({ slug }),
  });

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "camp-1",
  orgId: "org-1",
  title: "Summer Drop",
  status: "IN_PROGRESS",
  publicSlug: "summer-drop",
  currency: "USD",
  guidelines: "Post a 30s clip using the sound.",
  requirements: "Must tag @brand",
  contentAssetsUrl: "https://drive.example/assets",
  ratePerThousand: { TIKTOK: 100 },
  minPayoutMinor: 2000,
  submissionDeadline: null,
  marketplaceVisibility: "GLOBAL",
  deletedAt: null,
  org: { name: "Org One", logoUrl: null },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ creatorUserId: "cu-1", handle: "awxyken", name: "Awx", email: "a@b.com" });
  mockDb.campaign.findUnique.mockResolvedValue(campaign());
  mockDb.creator.findFirst.mockResolvedValue(null);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.activation.findFirst.mockResolvedValue(null);
  mockDb.post.findMany.mockResolvedValue([]);
  mockDb.post.count.mockResolvedValue(0);
  mockDb.campaignRules.findFirst.mockResolvedValue(null);
  mockDb.postAnnotation.findMany.mockResolvedValue([]);
  mockDb.creator.findUnique.mockResolvedValue(null);
  mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue(null);
});

it("returns 401 with no creator session", async () => {
  mockSession.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
});

it("serves a GLOBAL campaign to a creator who has not joined", async () => {
  const res = await call();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.joined).toBe(false);
  expect(body.campaign.guidelines).toBe("Post a 30s clip using the sound.");
});

it("404s a campaign that reverted to PRIVATE", async () => {
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
  const res = await call();
  expect(res.status).toBe(404);
  const body = await res.json();
  expect(body.campaign).toBeUndefined();
  expect(body.error).toBe("Campaign not found");
});

it("404s an INVITE_ONLY campaign for a creator who never joined", async () => {
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "INVITE_ONLY" }));
  expect((await call()).status).toBe(404);
});

it("still serves an INVITE_ONLY campaign to the creator who joined it", async () => {
  // joinCampaignBySlug admits INVITE_ONLY with a valid code, and the portal
  // sends the creator straight here afterwards — so an activation is the second
  // way through, and gating on GLOBAL alone would lock them out of their work.
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "INVITE_ONLY" }));
  mockDb.creator.findFirst.mockResolvedValue({ id: "cr-1" });
  mockDb.activation.findFirst.mockResolvedValue({
    id: "act-1",
    status: "ACCEPTED",
    draftUrl: null,
    draftCaption: null,
    draftMediaType: null,
    draftSubmittedAt: null,
    feedbackNotes: null,
  });

  const res = await call();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.joined).toBe(true);
  expect(body.campaign.id).toBe("camp-1");
});

it("404s a soft-deleted campaign before it looks at visibility", async () => {
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ deletedAt: new Date() }));
  expect((await call()).status).toBe(404);
  expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
  expect(mockDb.creator.findMany).not.toHaveBeenCalled();
});

// ─── F10: a private campaign opens only through a roster row linked to this login ───

const activationRow = {
  id: "act-1",
  creatorId: "cr-linked",
  status: "ACCEPTED",
  deliverableDueDate: null,
  draftUrl: null,
  draftCaption: null,
  draftMediaType: null,
  draftSubmittedAt: null,
  feedbackNotes: null,
};

it("serves a PRIVATE campaign to the login its roster row is linked to", async () => {
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
  mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
  mockDb.activation.findFirst.mockResolvedValue(activationRow);

  const res = await call();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.joined).toBe(true);
  expect(body.campaign.joinable).toBe(false);
  expect(body.campaign.marketplace).toBe(false);
  // The roster lookup is scoped to the campaign's org and to this login.
  expect(mockDb.creator.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ orgId: "org-1", creatorUserId: "cu-1", deletedAt: null }),
    }),
  );
});

it("404s a PRIVATE campaign to a login that only shares the handle of a creator on it", async () => {
  // Someone registered @awxyken in the portal. The agency's roster row for the
  // real @awxyken is on the campaign, but it is not linked to this login.
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.creator.findFirst.mockResolvedValue({ id: "cr-handle" });
  mockDb.activation.findFirst.mockResolvedValue({ ...activationRow, creatorId: "cr-handle" });

  const res = await call();
  expect(res.status).toBe(404);
  // The handle path is never consulted for a private campaign.
  expect(mockDb.creator.findFirst).not.toHaveBeenCalled();
  expect(mockDb.activation.findFirst).not.toHaveBeenCalled();
});

it("404s a PRIVATE campaign to a linked login with no activation on it", async () => {
  mockDb.campaign.findUnique.mockResolvedValue(campaign({ marketplaceVisibility: "PRIVATE" }));
  mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
  mockDb.activation.findFirst.mockResolvedValue(null);
  expect((await call()).status).toBe(404);
});

it("opens a private campaign by id when no public slug matches", async () => {
  const id = "cabcdefghijklmnopqrstuv1";
  mockDb.campaign.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(campaign({ id, publicSlug: null, marketplaceVisibility: "PRIVATE" }));
  mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
  mockDb.activation.findFirst.mockResolvedValue(activationRow);

  const res = await call(id);
  expect(res.status).toBe(200);
  expect(mockDb.campaign.findUnique).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ where: { id } }),
  );
});

it("does not try a key that cannot be a campaign id as one", async () => {
  mockDb.campaign.findUnique.mockResolvedValueOnce(null);
  const res = await call("no-such-slug");
  expect(res.status).toBe(404);
  expect(mockDb.campaign.findUnique).toHaveBeenCalledTimes(1);
});

it("lists the campaign's dates, the creator's due date first", async () => {
  const due = new Date("2026-11-01T00:00:00Z");
  mockDb.campaign.findUnique.mockResolvedValue(
    campaign({ submissionDeadline: new Date("2026-11-10T00:00:00Z") }),
  );
  mockDb.creator.findMany.mockResolvedValue([{ id: "cr-linked" }]);
  mockDb.activation.findFirst.mockResolvedValue({ ...activationRow, deliverableDueDate: due });

  const body = await (await call()).json();
  expect(body.campaign.dates.map((d: { kind: string }) => d.kind)).toEqual([
    "post_due",
    "submissions_close",
  ]);
});

/* The agency's checklist, submission rules and launch date (lib/campaigns/rules). */
describe("campaign rules", () => {
  const rulesRow = (over: Record<string, unknown> = {}) => ({
    dos: ["Use the sound"],
    donts: ["No competitor logos"],
    examplePostUrls: ["https://www.tiktok.com/@x/video/1"],
    minFollowers: null,
    requiredHashtags: [],
    requiredMentions: [],
    maxPostsPerAccount: null,
    launchAt: null,
    viewGoal: null,
    ...over,
  });
  const joinedActivation = {
    id: "act-1",
    creatorId: "cr-1",
    status: "ACCEPTED",
    draftUrl: null,
    draftCaption: null,
    draftMediaType: null,
    draftSubmittedAt: null,
    feedbackNotes: null,
  };
  const join = () => {
    mockDb.creator.findFirst.mockResolvedValue({ id: "cr-1" });
    mockDb.activation.findFirst.mockResolvedValue(joinedActivation);
  };

  it("serves no checklist and no checks when the agency set none", async () => {
    join();
    const body = await (await call()).json();
    expect(body.campaign.checklist).toEqual({ dos: [], donts: [], examples: [] });
    expect(body.campaign.ruleChecks).toEqual([]);
    expect(body.campaign.scheduledUntil).toBeNull();
    expect(body.campaign.acceptsPosts).toBe(true);
  });

  it("serves the checklist to a creator who has not joined", async () => {
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow());
    const body = await (await call()).json();
    expect(body.campaign.checklist).toEqual({
      dos: ["Use the sound"],
      donts: ["No competitor logos"],
      examples: ["https://www.tiktok.com/@x/video/1"],
    });
    // Rule checks are about the creator's own account, so only once joined.
    expect(body.campaign.ruleChecks).toEqual([]);
  });

  it("checks the rules against the joined creator's measured followers", async () => {
    join();
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ minFollowers: 10_000, requiredHashtags: ["#drop"] }));
    mockDb.creator.findUnique.mockResolvedValue({ platform: "TIKTOK", followersCount: 0 });
    mockDb.creatorTrackerSnapshot.findFirst.mockResolvedValue({ followersCount: 25_000, recordedAt: new Date("2026-10-20T00:00:00Z") });
    const body = await (await call()).json();
    const byKey = Object.fromEntries(body.campaign.ruleChecks.map((c: { key: string }) => [c.key, c]));
    expect(byKey.followers.state).toBe("pass");
    expect(byKey.followers.detail).toMatch(/25,000/);
    expect(byKey.hashtags.state).toBe("pending");
    expect(body.campaign.ruleChecksPlatform).toBe("TIKTOK");
  });

  it("closes a scheduled campaign to posts and to joining until its launch date", async () => {
    const launch = new Date(Date.now() + 5 * 86_400_000);
    mockDb.campaignRules.findFirst.mockResolvedValue(rulesRow({ launchAt: launch }));
    const body = await (await call()).json();
    expect(body.campaign.scheduledUntil).toBe(launch.toISOString());
    expect(body.campaign.acceptsPosts).toBe(false);
    expect(body.campaign.joinable).toBe(false);
  });

  it("returns each submission's boost code, and nothing of the agency's notes", async () => {
    join();
    mockDb.post.findMany.mockResolvedValue([
      {
        id: "p-1",
        postUrl: "https://www.tiktok.com/@a/video/9",
        platform: "TIKTOK",
        status: "PENDING_REVIEW",
        viewsCount: 0,
        thumbnailUrl: null,
        caption: null,
        rejectionReason: null,
        createdAt: new Date(),
        lastSyncedAt: null,
        platformMetrics: null,
      },
    ]);
    mockDb.postAnnotation.findMany.mockResolvedValue([
      { postId: "p-1", boostCode: "SPARK1", boostCodeExpiresAt: new Date("2026-12-01T00:00:00Z"), ruleNotes: ["Caption not read"], exclusionReason: null },
    ]);
    const body = await (await call()).json();
    expect(body.submissions[0].boostCode).toBe("SPARK1");
    expect(body.submissions[0].boostCodeExpiresAt).toBe("2026-12-01T00:00:00.000Z");
    expect(body.submissions[0].ruleNotes).toBeUndefined();
    /* Listed even with boost codes off: it is the creator's own code. */
    expect(body.campaign.boostCodes).toBe(false);
  });

  it("says whether the agency asks for boost codes on this campaign", async () => {
    join();
    mockDb.campaignRules.findFirst.mockResolvedValue({ allowBoostCodes: true, allowExclusions: false });
    expect((await (await call()).json()).campaign.boostCodes).toBe(true);
  });

  it("serves the campaign as before when the rules table does not exist yet", async () => {
    join();
    mockDb.campaignRules.findFirst.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    mockDb.postAnnotation.findMany.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2021" }));
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).campaign.acceptsPosts).toBe(true);
  });
});
