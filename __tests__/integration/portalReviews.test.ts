/**
 * @jest-environment node
 */
import { GET as getPortalReviews } from "@/app/api/portal/reviews/route";

jest.mock("@/lib/db", () => ({
  db: {
    creator: { findMany: jest.fn() },
    creatorSocialAccount: { findMany: jest.fn() },
    creatorReview: { findMany: jest.fn() },
  },
}));

jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

const mockGetCreatorSession = getCreatorSession as jest.Mock;
const mockDb = db as any;

const authedCreatorSession = {
  id: "sess-1",
  creatorUserId: "cu-1",
  email: "creator@demo.com",
  name: "Blessing Jolie",
  handle: "blessingjolie",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCreatorSession.mockResolvedValue(authedCreatorSession);
  // contactEmail matches the session email, so c1 is a proven-ownership row.
  mockDb.creator.findMany.mockResolvedValue([
    { id: "c1", orgId: "org-1", contactEmail: "creator@demo.com" },
  ]);
  mockDb.creatorSocialAccount.findMany.mockResolvedValue([]);
  mockDb.creatorReview.findMany.mockResolvedValue([]);
});

describe("GET /api/portal/reviews", () => {
  it("returns 401 when no session", async () => {
    mockGetCreatorSession.mockResolvedValue(null);
    const res = await getPortalReviews();
    expect(res.status).toBe(401);
  });

  it("returns 200 with reviews", async () => {
    mockDb.creatorReview.findMany.mockResolvedValue([
      {
        id: "r1",
        creatorId: "c1",
        rating: 5,
        tags: ["on_time"],
        comment: null,
        createdAt: new Date(),
        org: { id: "o1", name: "Sony Music" },
        campaign: { id: "camp-1", title: "Summer Drop" },
      },
    ]);
    const res = await getPortalReviews();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0].rating).toBe(5);
  });

  it("returns empty array when no creator records match handle", async () => {
    mockDb.creator.findMany.mockResolvedValue([]);
    const res = await getPortalReviews();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(0);
    // Should NOT call creatorReview.findMany when no creators found
    expect(mockDb.creatorReview.findMany).not.toHaveBeenCalled();
  });

  it("returns 200 with empty reviews when creator has no reviews", async () => {
    mockDb.creatorReview.findMany.mockResolvedValue([]);
    const res = await getPortalReviews();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviews).toHaveLength(0);
  });
});

/* A handle match is not ownership. Registering an existing roster creator's
   handle used to surface every brand review written about that creator.
   See lib/portal/creatorLink.ts. */
describe("GET /api/portal/reviews — ownership", () => {
  it("returns no reviews for a bare handle match with no proof", async () => {
    mockDb.creator.findMany.mockResolvedValue([
      { id: "c1", orgId: "org-1", contactEmail: "the-real-creator@example.com" },
    ]);
    const res = await getPortalReviews();
    expect(res.status).toBe(200);
    expect((await res.json()).reviews).toEqual([]);
    expect(mockDb.creatorReview.findMany).not.toHaveBeenCalled();
  });
});
