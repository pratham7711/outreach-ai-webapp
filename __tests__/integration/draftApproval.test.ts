/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { PATCH as patchActivation } from "@/app/api/activations/[id]/route";
import { POST as submitDraft } from "@/app/api/portal/campaigns/[slug]/draft/route";

jest.mock("@/lib/db", () => ({
  db: {
    activation: { findFirst: jest.fn(), update: jest.fn() },
    campaign: { findUnique: jest.fn() },
    creator: { findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";

const mockAuth = auth as jest.Mock;
const mockCreatorSession = getCreatorSession as jest.Mock;
const mockDb = db as any;

const owner = { user: { id: "user-1", orgId: "org-1", role: "OWNER" } };
const campaignRef = { createdById: "user-1" };

function patchReq(body: unknown) {
  return new NextRequest("http://localhost/api/activations/act-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function draftReq(body: unknown) {
  return new NextRequest("http://localhost/api/portal/campaigns/my-campaign/draft", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = { params: Promise.resolve({ id: "act-1" }) } as any;
const slugParams = { params: Promise.resolve({ slug: "my-campaign" }) } as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(owner);
});

// ─── Agency: approve / request changes ───────────────────────────────────────

describe("PATCH /api/activations/[id] — draft approval", () => {
  it("approves a submitted draft", async () => {
    mockDb.activation.findFirst.mockResolvedValue({
      id: "act-1", status: "DRAFT_SUBMITTED", feedbackNotes: null, postedUrl: null, campaign: campaignRef,
    });
    mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "APPROVED" });

    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(200);
    expect(mockDb.activation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) })
    );
  });

  it("declines a submitted draft with revision notes", async () => {
    mockDb.activation.findFirst.mockResolvedValue({
      id: "act-1", status: "DRAFT_SUBMITTED", feedbackNotes: null, postedUrl: null, campaign: campaignRef,
    });
    mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "DECLINED", feedbackNotes: "Reshoot the hook" });

    const res = await patchActivation(
      patchReq({ status: "DECLINED", feedbackNotes: "Reshoot the hook" }),
      params
    );
    expect(res.status).toBe(200);
    expect(mockDb.activation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DECLINED", feedbackNotes: "Reshoot the hook" }),
      })
    );
  });

  it("blocks a VIEWER from approving a draft (403, no write)", async () => {
    mockAuth.mockResolvedValue({ user: { id: "v-1", orgId: "org-1", role: "VIEWER" } });
    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(403);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("blocks a MEMBER from approving on a campaign they did not create", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m-1", orgId: "org-1", role: "MEMBER" } });
    mockDb.activation.findFirst.mockResolvedValue({
      id: "act-1", status: "DRAFT_SUBMITTED", campaign: { createdById: "someone-else" },
    });
    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(403);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("allows a MEMBER to approve on their own campaign", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m-1", orgId: "org-1", role: "MEMBER" } });
    mockDb.activation.findFirst.mockResolvedValue({
      id: "act-1", status: "DRAFT_SUBMITTED", feedbackNotes: null, postedUrl: null,
      campaign: { createdById: "m-1" },
    });
    mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "APPROVED" });

    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(200);
  });

  it("rejects an illegal transition (POSTED -> APPROVED)", async () => {
    mockDb.activation.findFirst.mockResolvedValue({
      id: "act-1", status: "POSTED", campaign: campaignRef,
    });
    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(400);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("returns 404 for an activation outside the caller's org", async () => {
    mockDb.activation.findFirst.mockResolvedValue(null);
    const res = await patchActivation(patchReq({ status: "APPROVED" }), params);
    expect(res.status).toBe(404);
  });
});

// ─── Creator portal: submit a draft ──────────────────────────────────────────

describe("POST /api/portal/campaigns/[slug]/draft", () => {
  /* marketplaceVisibility is load-bearing now: the route applies the same gate
     as /api/portal/campaigns/[slug], so a campaign that is not GLOBAL 404s a
     creator with no activation instead of reporting its deadline. See
     __tests__/integration/portalCampaignWrites.test.ts for that gate. */
  const joinedCampaign = {
    id: "camp-1", orgId: "org-1", deletedAt: null, submissionDeadline: null,
    marketplaceVisibility: "GLOBAL",
  };

  beforeEach(() => {
    mockCreatorSession.mockResolvedValue({ handle: "@alice" });
    mockDb.campaign.findUnique.mockResolvedValue(joinedCampaign);
    mockDb.creator.findFirst.mockResolvedValue({ id: "creator-1" });
  });

  it("submits a draft and moves the activation to DRAFT_SUBMITTED", async () => {
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "AWAITING_DRAFT" });
    mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "DRAFT_SUBMITTED" });

    const res = await submitDraft(
      draftReq({ draftUrl: "https://drive.google.com/file/d/abc", draftCaption: "hook v2", draftMediaType: "REEL" }),
      slugParams
    );
    expect(res.status).toBe(201);
    expect(mockDb.activation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DRAFT_SUBMITTED",
          draftUrl: "https://drive.google.com/file/d/abc",
          draftCaption: "hook v2",
          draftMediaType: "REEL",
          feedbackNotes: null,
        }),
      })
    );
  });

  it("lets a creator resubmit after a decline", async () => {
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "DECLINED" });
    mockDb.activation.update.mockResolvedValue({ id: "act-1", status: "DRAFT_SUBMITTED" });

    const res = await submitDraft(draftReq({ draftUrl: "https://example.com/v2" }), slugParams);
    expect(res.status).toBe(201);
  });

  it("rejects submission once the draft is already approved", async () => {
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "APPROVED" });
    const res = await submitDraft(draftReq({ draftUrl: "https://example.com/sneaky" }), slugParams);
    expect(res.status).toBe(409);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("returns 401 without a creator session", async () => {
    mockCreatorSession.mockResolvedValue(null);
    const res = await submitDraft(draftReq({ draftUrl: "https://example.com/x" }), slugParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the creator has not joined the campaign", async () => {
    mockDb.activation.findFirst.mockResolvedValue(null);
    const res = await submitDraft(draftReq({ draftUrl: "https://example.com/x" }), slugParams);
    expect(res.status).toBe(403);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("rejects a non-URL draft link", async () => {
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "AWAITING_DRAFT" });
    const res = await submitDraft(draftReq({ draftUrl: "not-a-url" }), slugParams);
    expect(res.status).toBe(400);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  // The draft link is rendered as a clickable <a href> in the AGENCY dashboard.
  // A non-http scheme from a creator would be stored XSS against the agency.
  it.each([
    ["javascript:", "javascript:fetch('//evil')"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["vbscript", "vbscript:msgbox(1)"],
  ])("rejects a %s draft link (stored-XSS guard)", async (_label, url) => {
    mockDb.activation.findFirst.mockResolvedValue({ id: "act-1", status: "AWAITING_DRAFT" });
    const res = await submitDraft(draftReq({ draftUrl: url }), slugParams);
    expect(res.status).toBe(400);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });

  it("blocks submission after the deadline", async () => {
    mockDb.campaign.findUnique.mockResolvedValue({
      ...joinedCampaign,
      submissionDeadline: new Date(Date.now() - 86_400_000),
    });
    const res = await submitDraft(draftReq({ draftUrl: "https://example.com/late" }), slugParams);
    expect(res.status).toBe(409);
    expect(mockDb.activation.update).not.toHaveBeenCalled();
  });
});
