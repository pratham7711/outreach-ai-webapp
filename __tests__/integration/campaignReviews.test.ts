/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as getReviews, POST as postReview } from "@/app/api/campaigns/[id]/reviews/route";

jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findFirst: jest.fn() },
    creatorReview: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    creator: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(), createAuditActor: jest.fn().mockReturnValue({ actorId: "u1", actorType: "user", actorEmail: "a@b.com" }) }));
jest.mock("@/lib/request", () => ({ getRequestIp: jest.fn().mockReturnValue("127.0.0.1") }));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn(), getAuditActor: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const authedSession = { user: { id: "user-1", orgId: "org-1" } };

function makeGetRequest(campaignId = "camp-1") {
  return new NextRequest(`http://localhost/api/campaigns/${campaignId}/reviews`);
}

function makePostRequest(campaignId = "camp-1", body: object) {
  return new NextRequest(`http://localhost/api/campaigns/${campaignId}/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// params helper
function params(id = "camp-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(authedSession);
  mockDb.campaign.findFirst.mockResolvedValue({ id: "camp-1", orgId: "org-1" });
  mockDb.creatorReview.findMany.mockResolvedValue([]);
  mockDb.creator.findMany.mockResolvedValue([]);
  mockDb.creatorReview.findFirst.mockResolvedValue(null);
  mockDb.creatorReview.create.mockResolvedValue({ id: "rev-1", creatorId: "c1", rating: 4, tags: ["on_time"], comment: null, createdAt: new Date(), orgId: "org-1", campaignId: "camp-1" });
  mockDb.creator.findFirst.mockResolvedValue({ id: "c1", name: "Test Creator", handle: "@test", orgId: "org-1" });
});

describe("GET /api/campaigns/[id]/reviews", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await getReviews(makeGetRequest(), params());
    expect(res.status).toBe(401);
  });

  it("returns 404 when campaign not in org", async () => {
    mockDb.campaign.findFirst.mockResolvedValue(null);
    const res = await getReviews(makeGetRequest(), params());
    expect(res.status).toBe(404);
  });

  it("returns 200 with reviews array", async () => {
    mockDb.creatorReview.findMany.mockResolvedValue([{ id: "r1", creatorId: "c1", rating: 5, tags: ["on_time"], comment: "Great!", createdAt: new Date(), orgId: "org-1", campaignId: "camp-1" }]);
    mockDb.creator.findMany.mockResolvedValue([{ id: "c1", name: "Jane", handle: "@jane", avatarUrl: null }]);
    const res = await getReviews(makeGetRequest(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].rating).toBe(5);
  });
});

describe("POST /api/campaigns/[id]/reviews", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await postReview(makePostRequest("camp-1", { creatorId: "c1", rating: 4, tags: [], comment: "" }), params());
    expect(res.status).toBe(401);
  });

  it("returns 201 and creates review", async () => {
    const res = await postReview(makePostRequest("camp-1", { creatorId: "c1", rating: 4, tags: ["on_time"], comment: "Good work" }), params());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.review ?? body).toBeTruthy();
  });

  it("returns 409 for duplicate review", async () => {
    mockDb.creatorReview.findFirst.mockResolvedValue({ id: "existing" });
    const res = await postReview(makePostRequest("camp-1", { creatorId: "c1", rating: 3, tags: [], comment: "" }), params());
    expect(res.status).toBe(409);
  });

  it("returns 400 for invalid rating (> 5)", async () => {
    const res = await postReview(makePostRequest("camp-1", { creatorId: "c1", rating: 6, tags: [], comment: "" }), params());
    expect(res.status).toBe(400);
  });
});
