/**
 * @jest-environment node
 *
 * A picture uploaded for a campaign from the new-campaign form or the Edit tab
 * (lib/campaigns/thumbnailCopy, lib/campaigns/uploadedPicture). It is filed
 * under this app's own address for the campaign's picture, so the copy and the
 * campaign name the same picture and every screen that prefers our copy shows
 * it. What is pinned here: it is kept as our own AVIF under the campaign's org,
 * the campaign and the copy change together, the background capture never
 * replaces it, and a removal takes both away.
 */
jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
    campaignThumbnail: { findMany: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  },
}));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn(), resizeImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { loadImage, resizeImage } from "@/lib/media/loadImage";
import { pictureKey, pictureLink } from "@/lib/campaigns/pictureLink";
import { isUploadedThumbnailUrl, uploadedThumbnailUrl } from "@/lib/campaigns/uploadedPicture";
import {
  CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES,
  captureCampaignThumbnail,
  readStoredCampaignThumbnail,
  removeCampaignThumbnail,
  storeCampaignThumbnailUpload,
  storedCampaignThumbnails,
} from "@/lib/campaigns/thumbnailCopy";
import { campaignArtwork } from "@/lib/campaignArtwork";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>> & { $transaction: jest.Mock };
const resize = resizeImage as jest.Mock;
const load = loadImage as jest.Mock;
const ORIGIN = "https://campaign.example.com";
const campaign = { id: "camp-1", orgId: "org-1" };

beforeEach(() => {
  jest.resetAllMocks();
  mdb.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

describe("the address an upload is filed under", () => {
  it("is this app's own picture route for the campaign", () => {
    const url = uploadedThumbnailUrl(ORIGIN, "camp-1", "0123456789abcdef");
    expect(url).toBe("https://campaign.example.com/api/campaigns/camp-1/thumbnail?upload=0123456789abcdef");
    expect(isUploadedThumbnailUrl(url, "camp-1")).toBe(true);
  });

  it("is told apart from a sound's cover, another campaign's upload and junk", () => {
    expect(isUploadedThumbnailUrl("https://p16-sg.tiktokcdn.com/aweme/720x720/a.jpeg", "camp-1")).toBe(false);
    expect(isUploadedThumbnailUrl(uploadedThumbnailUrl(ORIGIN, "camp-2", "aa"), "camp-1")).toBe(false);
    expect(isUploadedThumbnailUrl(`${ORIGIN}/api/campaigns/camp-1/thumbnail?v=3`, "camp-1")).toBe(false);
    expect(isUploadedThumbnailUrl("not a url", "camp-1")).toBe(false);
    expect(isUploadedThumbnailUrl(null, "camp-1")).toBe(false);
  });

  it("survives pictureLink and keys by host and path, so the copy matches the campaign", () => {
    const first = uploadedThumbnailUrl(ORIGIN, "camp-1", "aaaa");
    expect(pictureLink(first)).toBe(first);
    expect(pictureKey(pictureLink(first))).toBe("campaign.example.com/api/campaigns/camp-1/thumbnail");
  });
});

describe("storeCampaignThumbnailUpload", () => {
  it("keeps our own 384px AVIF under the campaign's org and points the campaign at it, together", async () => {
    resize.mockResolvedValue(Buffer.from("avif-bytes"));

    const result = await storeCampaignThumbnailUpload(campaign, Buffer.from("png-bytes"), ORIGIN);

    expect(resize).toHaveBeenCalledWith(expect.any(Buffer), false, 384, 384, "inside", "avif");
    expect(result).toEqual({ stored: true, bytes: 10, thumbnailUrl: expect.stringMatching(/\/api\/campaigns\/camp-1\/thumbnail\?upload=[0-9a-f]{16}$/) });
    if (!result.stored) throw new Error("not stored");
    expect(mdb.$transaction).toHaveBeenCalledTimes(1);
    expect(mdb.campaign.updateMany).toHaveBeenCalledWith({ where: { id: "camp-1", orgId: "org-1" }, data: { thumbnailUrl: result.thumbnailUrl } });
    expect(mdb.campaignThumbnail.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: "camp-1" },
        create: expect.objectContaining({ campaignId: "camp-1", orgId: "org-1", sourceUrl: result.thumbnailUrl }),
        update: expect.objectContaining({ sourceUrl: result.thumbnailUrl, failedAt: null, failure: null }),
      })
    );
  });

  it("names a different picture with a different address, so screens ask for it again", async () => {
    resize.mockResolvedValue(Buffer.from("avif"));
    const a = await storeCampaignThumbnailUpload(campaign, Buffer.from("one"), ORIGIN);
    const b = await storeCampaignThumbnailUpload(campaign, Buffer.from("two"), ORIGIN);
    expect(a.stored && b.stored && a.thumbnailUrl !== b.thumbnailUrl).toBe(true);
  });

  it("passes HEIC through to the decoder that reads it", async () => {
    resize.mockResolvedValue(Buffer.from("avif"));
    await storeCampaignThumbnailUpload(campaign, Buffer.from("heic"), ORIGIN, true);
    expect(resize.mock.calls[0][1]).toBe(true);
  });

  it("knows a HEIC from its bytes when it was sent as image/jpeg (saved as photo.jpg)", async () => {
    resize.mockResolvedValue(Buffer.from("avif"));
    const heicAsJpeg = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0mif1heic", "latin1")]);
    await storeCampaignThumbnailUpload(campaign, heicAsJpeg, ORIGIN, false);
    expect(resize.mock.calls[0][1]).toBe(true);
  });

  it("refuses a file over the cap, and one that is not a picture, writing nothing", async () => {
    const big = await storeCampaignThumbnailUpload(campaign, Buffer.alloc(CAMPAIGN_THUMBNAIL_UPLOAD_MAX_BYTES + 1), ORIGIN);
    expect(big).toEqual({ stored: false, status: 413, failure: "too large" });

    resize.mockRejectedValue(new Error("unsupported image format"));
    const junk = await storeCampaignThumbnailUpload(campaign, Buffer.from("%PDF"), ORIGIN);
    expect(junk).toEqual({ stored: false, status: 422, failure: "not an image" });

    expect(mdb.$transaction).not.toHaveBeenCalled();
    expect(mdb.campaign.updateMany).not.toHaveBeenCalled();
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });
});

describe("an uploaded picture on the screens", () => {
  const url = uploadedThumbnailUrl(ORIGIN, "camp-1", "0123456789abcdef");
  const fetchedAt = new Date("2026-10-22T10:00:00Z");

  it("is served from our copy, and the list gets a version for it", async () => {
    mdb.campaign.findFirst.mockResolvedValue({ thumbnailUrl: url, thumbnailCopy: { data: new Uint8Array([1]), fetchedAt, sourceUrl: url, failedAt: null } });
    expect(await readStoredCampaignThumbnail("camp-1", "org-1")).toEqual({ data: new Uint8Array([1]), fetchedAt });

    mdb.campaignThumbnail.findMany.mockResolvedValue([{ campaignId: "camp-1", fetchedAt, sourceUrl: url, failedAt: null }]);
    const states = await storedCampaignThumbnails([{ id: "camp-1", thumbnailUrl: url }], "org-1");
    expect(states.get("camp-1")).toEqual({ version: fetchedAt.getTime() });
  });

  it("goes ahead of the sound's cover", () => {
    const art = campaignArtwork(
      { thumbnailUrl: url, song: { sound: { id: "s1", coverImageUrl: "https://p16-sg.tiktokcdn.com/aweme/720x720/a.jpeg" } } },
      { thumbnail: "/api/campaigns/camp-1/thumbnail?v=1", soundCover: "/api/sounds/s1/cover?v=1" }
    );
    expect(art).toBe("/api/campaigns/camp-1/thumbnail?v=1");
  });

  it("is never downloaded or replaced by the background capture", async () => {
    mdb.campaign.findUnique.mockResolvedValue({ orgId: "org-1", thumbnailUrl: url, thumbnailCopy: { fetchedAt, sourceUrl: url, failedAt: null } });

    expect(await captureCampaignThumbnail("camp-1")).toBe("skipped");
    expect(load).not.toHaveBeenCalled();
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });
});

describe("removeCampaignThumbnail", () => {
  it("clears the campaign's picture and its copy in the campaign's own org, together", async () => {
    await removeCampaignThumbnail(campaign);

    expect(mdb.$transaction).toHaveBeenCalledTimes(1);
    expect(mdb.campaign.updateMany).toHaveBeenCalledWith({ where: { id: "camp-1", orgId: "org-1" }, data: { thumbnailUrl: null } });
    expect(mdb.campaignThumbnail.deleteMany).toHaveBeenCalledWith({ where: { campaignId: "camp-1", orgId: "org-1" } });
  });
});
