/**
 * @jest-environment node
 *
 * /c/[handle] is unauthenticated and reachable by anyone who guesses a handle.
 *
 * CreatorReview text, the reviewing org and the campaign title were removed from
 * it already — those are an agency's private assessment. CreatorTestimonial
 * arrived at the same disclosure by the other door: the creator writes the
 * quote, so the words are theirs to publish, but "Org One" plus "Summer Drop"
 * still states that a named brand ran a named campaign with this creator, and
 * nobody on the org side agreed to that.
 *
 * Checked before changing it: the model has no isPublic, no status and no
 * approvedAt, the API writes it straight through, and the authoring modal says
 * only "Share your experience working with orgs".
 */
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/lib/db", () => ({
  db: {
    creatorUser: { findFirst: jest.fn() },
    creatorTestimonial: { findMany: jest.fn() },
  },
}));
jest.mock("next/navigation", () => ({ notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import { db } from "@/lib/db";
import CreatorProfilePage from "@/app/(public)/c/[handle]/page";

const mockDb = db as any;

const ORG_NAME = "Northwind Beverages";
const CAMPAIGN_TITLE = "Summer Drop 2026";

const user = {
  id: "cu-1",
  handle: "awxyken",
  name: "Awx",
  bio: null,
  avatarUrl: null,
  platform: "TIKTOK",
  niches: [],
  followersCount: 1_000,
  averageViews: 400,
  rate: null,
  boostRate: null,
  lifetimeEarnings: 0,
  cpm: 1.5,
  averageRating: 4.5,
  reviewCount: 3,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

async function render() {
  const element = await CreatorProfilePage({ params: Promise.resolve({ handle: "awxyken" }) });
  return renderToStaticMarkup(element as React.ReactElement);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.creatorUser.findFirst.mockResolvedValue(user);
  mockDb.creatorTestimonial.findMany.mockResolvedValue([
    { id: "t-1", content: "Clear brief, paid on time, would work with them again." },
  ]);
});

describe("/c/[handle] testimonials", () => {
  it("reads only the id and the text, never the org or the campaign", async () => {
    await render();

    const [call] = mockDb.creatorTestimonial.findMany.mock.calls;
    expect(call[0].select).toEqual({ id: true, content: true });
    // An `include` here is how the org name and campaign title got onto the page.
    expect(call[0].include).toBeUndefined();
  });

  it("prints the creator's words", async () => {
    const html = await render();
    expect(html).toContain("Clear brief, paid on time");
  });

  it("names neither the org nor the campaign, even when the row carries them", async () => {
    // The row shape a stale caller might still hand it.
    mockDb.creatorTestimonial.findMany.mockResolvedValue([
      {
        id: "t-1",
        content: "Great to work with.",
        org: { name: ORG_NAME },
        campaign: { title: CAMPAIGN_TITLE },
      },
    ]);

    const html = await render();
    expect(html).toContain("Great to work with.");
    expect(html).not.toContain(ORG_NAME);
    expect(html).not.toContain(CAMPAIGN_TITLE);
  });

  it("still shows the review aggregate, which is the creator's own public figure", async () => {
    const html = await render();
    expect(html).toContain("3 reviews");
  });

  it("scopes the read to this creator user", async () => {
    await render();
    expect(mockDb.creatorTestimonial.findMany.mock.calls[0][0].where).toEqual({ creatorUserId: "cu-1" });
  });
});
