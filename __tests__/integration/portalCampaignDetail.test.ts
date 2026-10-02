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
    creator: { findFirst: jest.fn(), findMany: jest.fn() },
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
  mockDb.creator.findMany.mockResolvedValue([]);
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
