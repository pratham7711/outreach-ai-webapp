/**
 * lib/posts/addPostChecks — precheckPostUrl, which decides whether adding a
 * post has to ask an operator who posted it.
 *
 * The order of the three sources is the whole behaviour, and getting it wrong
 * is not a cosmetic bug: a post filed against the wrong creator is a wrong
 * payout. So each source is tested for when it wins AND when it must not.
 */
const mockPostFindMany = jest.fn();
const mockCreatorFindFirst = jest.fn();
const mockSocialFindFirst = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: (...a: unknown[]) => mockPostFindMany(...a) },
    creator: { findFirst: (...a: unknown[]) => mockCreatorFindFirst(...a) },
    creatorSocialAccount: { findFirst: (...a: unknown[]) => mockSocialFindFirst(...a) },
  },
}));

const mockResolveAuthor = jest.fn();
jest.mock("@/lib/platforms/postAuthor", () => ({
  resolveAuthorFromPlatform: (...a: unknown[]) => mockResolveAuthor(...a),
}));

import { precheckPostUrl } from "@/lib/posts/addPostChecks";

const ORG = "org-1";
const CAMPAIGN = "camp-1";

function existingRow(handle: string, creatorId = "cre-old") {
  return {
    id: "post-9",
    campaignId: "camp-2",
    campaign: { title: "Another campaign" },
    creator: { id: creatorId, name: handle, handle },
  };
}

describe("precheckPostUrl", () => {
  beforeEach(() => {
    mockPostFindMany.mockReset().mockResolvedValue([]);
    mockCreatorFindFirst.mockReset().mockResolvedValue(null);
    mockSocialFindFirst.mockReset().mockResolvedValue(null);
    mockResolveAuthor.mockReset().mockResolvedValue(null);
  });

  it("takes the handle out of the URL and never asks the platform", async () => {
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.tiktok.com/@jane/video/123", true);
    expect(r).toMatchObject({ handle: "jane", handleSource: "url" });
    expect(mockResolveAuthor).not.toHaveBeenCalled();
  });

  it("asks the platform when the link names nobody", async () => {
    mockResolveAuthor.mockResolvedValue({ handle: "jawed", name: "jawed" });
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.youtube.com/watch?v=jNQXAC9IVRw", true);
    expect(r).toMatchObject({ handle: "jawed", handleSource: "platform", authorName: "jawed" });
    expect(r.creatorWillBeAdded).toBe(true);
  });

  it("falls back to the org's own copy of the post when nobody names an author", async () => {
    mockPostFindMany.mockResolvedValue([existingRow("wave_of_change_")]);
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.instagram.com/reel/DbBr2C5TAxu/", true);
    expect(r).toMatchObject({ handle: "wave_of_change_", handleSource: "record" });
    expect(r.creator).toEqual({ id: "cre-old", name: "wave_of_change_", handle: "wave_of_change_" });
  });

  it("does not let an older filing override a handle the link names", async () => {
    /* The post is on record against somebody else. Preferring that would
       spread one wrong attribution to every later paste of the same link. */
    mockPostFindMany.mockResolvedValue([existingRow("someone_else")]);
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.tiktok.com/@jane/video/123", false);
    expect(r).toMatchObject({ handle: "jane", handleSource: "url", creator: null });
  });

  it("asks nobody and names nobody when all three sources are silent", async () => {
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.instagram.com/reel/GONE/", true);
    expect(r).toMatchObject({ handle: null, handleSource: null, creator: null, creatorWillBeAdded: false });
  });

  it("will not offer to add a creator on a seat that cannot add one", async () => {
    mockResolveAuthor.mockResolvedValue({ handle: "jawed", name: null });
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.youtube.com/watch?v=jNQXAC9IVRw", false);
    expect(r).toMatchObject({ handle: "jawed", creatorWillBeAdded: false });
  });

  it("reports the same post in this campaign separately from other campaigns", async () => {
    mockPostFindMany.mockResolvedValue([
      { ...existingRow("jane"), campaignId: CAMPAIGN, campaign: { title: "This campaign" } },
      existingRow("jane"),
    ]);
    const r = await precheckPostUrl(ORG, CAMPAIGN, "https://www.tiktok.com/@jane/video/123", true);
    expect(r.inThisCampaign?.campaignId).toBe(CAMPAIGN);
    expect(r.inOtherCampaigns).toHaveLength(1);
  });
});
