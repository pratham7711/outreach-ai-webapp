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
    creator: { findFirst: jest.fn() },
    activation: { findFirst: jest.fn() },
    post: { findMany: jest.fn() },
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
  mockDb.activation.findFirst.mockResolvedValue(null);
  mockDb.post.findMany.mockResolvedValue([]);
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
});
