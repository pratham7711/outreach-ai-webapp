/**
 * @jest-environment node
 *
 * POST /api/portal/invites/<token>/accept -- the Accept button on /invite/<token>.
 * Accepting links the invited roster row to the login, creates the activation
 * and marks the invite accepted; it never re-points a row another login holds.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    campaignInvite: { findUnique: jest.fn(), updateMany: jest.fn() },
    campaign: { findFirst: jest.fn() },
    creator: { findFirst: jest.fn(), updateMany: jest.fn() },
    activation: { findFirst: jest.fn(), create: jest.fn() },
  },
}));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));
jest.mock("@/lib/rateLimit", () => ({
  rateLimit: jest.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
  rateLimitKey: jest.fn(() => "k"),
}));

import { POST } from "@/app/api/portal/invites/[token]/accept/route";
import { loadInviteLanding } from "@/lib/portal/campaignInvite";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/rateLimit";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const mockSession = getCreatorSession as jest.Mock;
const TOKEN = "cinvtoken000000000000001";

const accept = (token = TOKEN) =>
  POST(new NextRequest(`http://localhost/api/portal/invites/${token}/accept`, { method: "POST" }), {
    params: Promise.resolve({ token }),
  });

const invite = (over: Record<string, unknown> = {}) => ({
  id: "inv-1",
  orgId: "org-1",
  campaignId: "camp-1",
  creatorId: "cr-1",
  status: "PENDING",
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ creatorUserId: "cu-1", email: "creator@example.test", handle: "fake_creator_one" });
  mdb.campaignInvite.findUnique.mockResolvedValue(invite());
  mdb.campaignInvite.updateMany.mockResolvedValue({ count: 1 });
  mdb.campaign.findFirst.mockResolvedValue({
    id: "camp-1",
    publicSlug: null,
    status: "IN_PROGRESS",
    submissionDeadline: new Date("2026-11-01T00:00:00Z"),
  });
  mdb.creator.findFirst.mockResolvedValue({ id: "cr-1", creatorUserId: null });
  mdb.creator.updateMany.mockResolvedValue({ count: 1 });
  mdb.activation.findFirst.mockResolvedValue(null);
  mdb.activation.create.mockResolvedValue({ id: "act-new" });
});

it("401s a signed-out visitor, so the landing page can send them to sign up", async () => {
  mockSession.mockResolvedValue(null);
  expect((await accept()).status).toBe(401);
  expect(mdb.campaignInvite.findUnique).not.toHaveBeenCalled();
});

it("429s once the rate limit is spent", async () => {
  (rateLimit as jest.Mock).mockReturnValueOnce({ allowed: false, retryAfterSeconds: 60 });
  const res = await accept();
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("60");
});

it("links the roster row, creates the activation and marks the invite accepted", async () => {
  const res = await accept();
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({
    campaignPath: "/portal/campaigns/camp-1",
    activationId: "act-new",
    alreadyAccepted: false,
  });

  // The link is conditional on the row still being unlinked, inside the invite's org.
  expect(mdb.creator.updateMany).toHaveBeenCalledWith({
    where: { id: "cr-1", orgId: "org-1", creatorUserId: null },
    data: { creatorUserId: "cu-1" },
  });
  expect(mdb.activation.create).toHaveBeenCalledWith({
    data: {
      campaignId: "camp-1",
      creatorId: "cr-1",
      deliverableDueDate: new Date("2026-11-01T00:00:00Z"),
    },
    select: { id: true },
  });
  expect(mdb.campaignInvite.updateMany).toHaveBeenCalledWith({
    where: { id: "inv-1", status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
  });
  expect(logAudit).toHaveBeenCalledWith(
    expect.objectContaining({ orgId: "org-1", actorType: "creator", action: "campaign_invite.accept" }),
  );
});

it("looks the campaign and roster row up inside the invite's org", async () => {
  await accept();
  expect(mdb.campaign.findFirst.mock.calls[0][0].where).toEqual({ id: "camp-1", orgId: "org-1", deletedAt: null });
  expect(mdb.creator.findFirst.mock.calls[0][0].where).toEqual({ id: "cr-1", orgId: "org-1", deletedAt: null });
});

it("reuses an existing activation instead of creating a second", async () => {
  mdb.activation.findFirst.mockResolvedValue({ id: "act-old" });
  const res = await accept();
  expect(res.status).toBe(200);
  expect((await res.json()).activationId).toBe("act-old");
  expect(mdb.activation.create).not.toHaveBeenCalled();
});

it("answers a repeat tap from the same login without writing anything", async () => {
  mdb.campaignInvite.findUnique.mockResolvedValue(invite({ status: "ACCEPTED" }));
  mdb.creator.findFirst.mockResolvedValue({ id: "cr-1", creatorUserId: "cu-1" });
  mdb.activation.findFirst.mockResolvedValue({ id: "act-old" });

  const res = await accept();
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ alreadyAccepted: true, activationId: "act-old" });
  expect(mdb.creator.updateMany).not.toHaveBeenCalled();
  expect(mdb.campaignInvite.updateMany).not.toHaveBeenCalled();
  expect(logAudit).not.toHaveBeenCalled();
});

it("refuses a forwarded link once another login holds the row", async () => {
  mdb.creator.findFirst.mockResolvedValue({ id: "cr-1", creatorUserId: "cu-someone-else" });
  const res = await accept();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/another account/);
  expect(mdb.creator.updateMany).not.toHaveBeenCalled();
  expect(mdb.activation.create).not.toHaveBeenCalled();
});

it("refuses the loser of two simultaneous accepts", async () => {
  mdb.creator.updateMany.mockResolvedValue({ count: 0 });
  const res = await accept();
  expect(res.status).toBe(409);
  expect(mdb.activation.create).not.toHaveBeenCalled();
  expect(mdb.campaignInvite.updateMany).not.toHaveBeenCalled();
});

it.each(["DECLINED", "EXPIRED"])("409s a %s invite", async (status) => {
  mdb.campaignInvite.findUnique.mockResolvedValue(invite({ status }));
  expect((await accept()).status).toBe(409);
  expect(mdb.creator.updateMany).not.toHaveBeenCalled();
});

it.each(["COMPLETE", "CANCELLED", "DRAFT"])("409s an invite to a %s campaign", async (status) => {
  mdb.campaign.findFirst.mockResolvedValue({ id: "camp-1", publicSlug: null, status, submissionDeadline: null });
  const res = await accept();
  expect(res.status).toBe(409);
  expect((await res.json()).error).toMatch(/closed/);
  expect(mdb.creator.updateMany).not.toHaveBeenCalled();
});

it("404s an unknown token, and a malformed one without querying", async () => {
  mdb.campaignInvite.findUnique.mockResolvedValue(null);
  expect((await accept()).status).toBe(404);

  mdb.campaignInvite.findUnique.mockClear();
  expect((await accept("not a token!")).status).toBe(404);
  expect(mdb.campaignInvite.findUnique).not.toHaveBeenCalled();
});

it("404s an invite whose campaign was deleted", async () => {
  mdb.campaign.findFirst.mockResolvedValue(null);
  expect((await accept()).status).toBe(404);
});

it("409s an invite whose roster row was removed", async () => {
  mdb.creator.findFirst.mockResolvedValue(null);
  expect((await accept()).status).toBe(409);
});

it("sends the creator to the campaign's public slug when it has one", async () => {
  mdb.campaign.findFirst.mockResolvedValue({
    id: "camp-1",
    publicSlug: "summer-drop",
    status: "IN_PROGRESS",
    submissionDeadline: null,
  });
  expect((await (await accept()).json()).campaignPath).toBe("/portal/campaigns/summer-drop");
});

describe("loadInviteLanding", () => {
  it("shows the brief and dates, and nothing naming the invited creator", async () => {
    mdb.campaign.findFirst.mockResolvedValue({
      title: "Autumn Drop",
      status: "IN_PROGRESS",
      guidelines: "Film outdoors",
      requirements: null,
      contentAssetsUrl: null,
      submissionDeadline: new Date("2026-11-01T00:00:00Z"),
      brief: { content: "  A short brief.  " },
      phases: [],
      org: { name: "Agency One", brandName: null, logoUrl: null },
    });
    const landing = await loadInviteLanding(TOKEN);
    expect(landing).toEqual({
      status: "PENDING",
      open: true,
      campaign: {
        title: "Autumn Drop",
        orgName: "Agency One",
        orgLogoUrl: null,
        brief: "A short brief.",
        guidelines: "Film outdoors",
        requirements: null,
        contentAssetsUrl: null,
        dates: [{ kind: "submissions_close", label: "Submissions close", at: "2026-11-01T00:00:00.000Z" }],
      },
    });
    // The roster row is never read for the public page.
    expect(mdb.creator.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(landing)).not.toMatch(/cr-1|creatorId/);
  });

  it("is null for an unknown or malformed token", async () => {
    mdb.campaignInvite.findUnique.mockResolvedValue(null);
    expect(await loadInviteLanding(TOKEN)).toBeNull();
    expect(await loadInviteLanding("../etc")).toBeNull();
  });

  it("marks a closed campaign as not open", async () => {
    mdb.campaign.findFirst.mockResolvedValue({
      title: "Old",
      status: "COMPLETE",
      guidelines: null,
      requirements: null,
      contentAssetsUrl: null,
      submissionDeadline: null,
      brief: null,
      phases: [],
      org: { name: "Agency One", brandName: null, logoUrl: null },
    });
    expect((await loadInviteLanding(TOKEN))?.open).toBe(false);
  });
});
