/**
 * @jest-environment node
 *
 * Our own copy of a campaign's picture (lib/campaigns/thumbnailCopy).
 *
 * Measured 2026-10-18 on one tenant: 18 of 528 campaign thumbnails drew
 * nothing -- uploads gone from CreatorCore, TikTok covers past their
 * signature, and music pages or YouTube videos saved where a picture belongs.
 * What is pinned here: only pictures are copied, a copy follows the link it
 * was taken from (a changed thumbnail never shows the old one), it is filed
 * under the campaign's own org, and a failure never erases a good copy.
 */
jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: jest.fn(), findFirst: jest.fn() },
    campaignThumbnail: { findMany: jest.fn(), upsert: jest.fn() },
  },
}));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));

import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { pictureKey, pictureLink } from "@/lib/campaigns/pictureLink";
import {
  CAMPAIGN_THUMBNAIL_RETRY_MS,
  captureCampaignThumbnail,
  readStoredCampaignThumbnail,
  storedCampaignThumbnails,
} from "@/lib/campaigns/thumbnailCopy";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const load = loadImage as jest.Mock;
const NOW = Date.parse("2026-10-18T12:00:00Z");
const webp = { ok: true, body: Buffer.from("webp-bytes"), contentType: "image/avif" };
const missingTable = () => Object.assign(new Error("The table `public.CampaignThumbnail` does not exist"), { code: "P2021" });
const bubble = (file: string) => `//x.cdn.bubble.io/${file}/image.png`;

beforeEach(() => jest.resetAllMocks());

describe("pictureLink", () => {
  it("normalises an upload's protocol-relative link the way the screens do", () => {
    expect(pictureLink(bubble("f1"))).toBe("https://x.cdn.bubble.io/f1/image.png");
    expect(pictureLink("http://x.cdn.bubble.io/f1/a.png")).toBe("https://x.cdn.bubble.io/f1/a.png");
  });

  it("turns a YouTube video into the picture YouTube serves for it", () => {
    expect(pictureLink("https://youtu.be/HP6AmFsxbU8")).toBe("https://i.ytimg.com/vi/HP6AmFsxbU8/hqdefault.jpg");
    expect(pictureLink("https://www.youtube.com/shorts/mhfEAAo1tn8")).toBe("https://i.ytimg.com/vi/mhfEAAo1tn8/hqdefault.jpg");
  });

  it("drops a page that is not a picture", () => {
    expect(pictureLink("https://www.tiktok.com/music/Raindance-123")).toBeNull();
    expect(pictureLink("https://www.instagram.com/reels/audio/1/")).toBeNull();
    expect(pictureLink("")).toBeNull();
    expect(pictureLink(null)).toBeNull();
  });

  it("keeps a TikTok CDN picture, which is not the TikTok site", () => {
    const cdn = "https://p16-sg.tiktokcdn.com/aweme/720x720/a.jpeg";
    expect(pictureLink(cdn)).toBe(cdn);
  });
});

describe("pictureKey", () => {
  it("names a TikTok picture by its object key, across signatures and hosts", () => {
    expect(pictureKey("https://p16-sign-sg.tiktokcdn.com/o/k1~c5_720x720.jpeg?x-expires=1&x-signature=a")).toBe(
      pictureKey("https://p77-sign-va.tiktokcdn-us.com/o/k1~c5_100x100.jpeg?x-expires=2&x-signature=b")
    );
  });

  it("names an upload by its whole path, since 'image.png' alone is everyone's", () => {
    expect(pictureKey(pictureLink(bubble("f1")))).not.toBe(pictureKey(pictureLink(bubble("f2"))));
    expect(pictureKey("https://i.ytimg.com/vi/a/hqdefault.jpg")).not.toBe(pictureKey("https://i.ytimg.com/vi/b/hqdefault.jpg"));
  });

  it("names a TikTok picture the same under its /aweme/ and /tos-/ forms", () => {
    expect(pictureKey("https://p16-sg.tiktokcdn.com/aweme/720x720/tos-alisg-v-2774/owg99.jpeg")).toBe(
      pictureKey("https://p16-common.tiktokcdn-us.com/tos-alisg-v-2774/owg99~tplv-obj.jpeg")
    );
  });

  it("names an Instagram picture by its file, across regional hosts", () => {
    const ig = (host: string, oe: string) => `https://${host}/v/t51.2885-15/461_123_n.jpg?oe=${oe}`;
    expect(pictureKey(ig("scontent-sin6-1.cdninstagram.com", "1"))).toBe(pictureKey(ig("scontent.fdel1-1.fna.fbcdn.net", "2")));
  });
});

describe("captureCampaignThumbnail", () => {
  const campaign = (thumbnailUrl: string | null, copy: Record<string, unknown> | null = null) => ({
    orgId: "org-1",
    thumbnailUrl,
    thumbnailCopy: copy,
  });

  it("keeps the picture under the campaign's own org, against the link it came from", async () => {
    mdb.campaign.findUnique.mockResolvedValue(campaign(bubble("f1")));
    load.mockResolvedValue(webp);
    mdb.campaignThumbnail.upsert.mockResolvedValue({});

    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("stored");
    const write = mdb.campaignThumbnail.upsert.mock.calls[0][0];
    expect(write.where).toEqual({ campaignId: "camp-1" });
    expect(write.create).toMatchObject({ campaignId: "camp-1", orgId: "org-1", sourceUrl: "https://x.cdn.bubble.io/f1/image.png" });
    expect(Buffer.from(write.create.data).toString()).toBe("webp-bytes");
  });

  it("does not download a picture it already holds", async () => {
    mdb.campaign.findUnique.mockResolvedValue(
      campaign(bubble("f1"), { fetchedAt: new Date(NOW - 1000), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null })
    );
    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("held");
    expect(load).not.toHaveBeenCalled();
  });

  it("downloads again when the campaign points at a different picture", async () => {
    mdb.campaign.findUnique.mockResolvedValue(
      campaign(bubble("f2"), { fetchedAt: new Date(NOW - 1000), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null })
    );
    load.mockResolvedValue(webp);
    mdb.campaignThumbnail.upsert.mockResolvedValue({});
    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("stored");
  });

  it("skips what is not a fetchable picture without touching the store", async () => {
    for (const url of [
      null,
      "https://www.tiktok.com/music/x-1",
      "https://example.com/logo.png", // outside the proxy's host list: loadImage would refuse it
      `https://p16-sign-sg.tiktokcdn.com/o/k~c.jpeg?x-expires=${Math.floor(NOW / 1000) - 60}&x-signature=s`,
    ]) {
      mdb.campaign.findUnique.mockResolvedValue(campaign(url));
      expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("skipped");
    }
    expect(load).not.toHaveBeenCalled();
    expect(mdb.campaignThumbnail.upsert).not.toHaveBeenCalled();
  });

  it("waits out a picture that failed lately, unless asked to retry", async () => {
    const failed = { fetchedAt: null, sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: new Date(NOW - 60_000) };
    mdb.campaign.findUnique.mockResolvedValue(campaign(bubble("f1"), failed));
    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("skipped");
    expect(load).not.toHaveBeenCalled();

    load.mockResolvedValue(webp);
    mdb.campaignThumbnail.upsert.mockResolvedValue({});
    expect(await captureCampaignThumbnail("camp-1", NOW, { retryFailed: true })).toBe("stored");

    mdb.campaign.findUnique.mockResolvedValue(
      campaign(bubble("f1"), { ...failed, failedAt: new Date(NOW - CAMPAIGN_THUMBNAIL_RETRY_MS - 1) })
    );
    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("stored");
  });

  it("records a failure without erasing the copy held, and never throws", async () => {
    mdb.campaign.findUnique.mockResolvedValue(
      campaign(bubble("f2"), { fetchedAt: new Date(NOW - 1000), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null })
    );
    load.mockResolvedValue({ ok: false, status: 502, message: "upstream error 404" });
    mdb.campaignThumbnail.upsert.mockResolvedValue({});
    expect(await captureCampaignThumbnail("camp-1", NOW)).toBe("failed");
    const update = mdb.campaignThumbnail.upsert.mock.calls[0][0].update;
    expect(update).not.toHaveProperty("data");
    expect(update).not.toHaveProperty("sourceUrl");

    mdb.campaign.findUnique.mockRejectedValue(missingTable());
    await expect(captureCampaignThumbnail("camp-1", NOW)).resolves.toBe("failed");
  });
});

describe("reading the copy back", () => {
  it("serves a copy only while the campaign still points at its picture", async () => {
    const copy = { data: new Uint8Array([1]), fetchedAt: new Date(NOW), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null };
    mdb.campaign.findFirst.mockResolvedValue({ thumbnailUrl: bubble("f1"), thumbnailCopy: copy });
    expect(await readStoredCampaignThumbnail("camp-1", "org-1")).toEqual({ data: copy.data, fetchedAt: copy.fetchedAt });
    expect(mdb.campaign.findFirst.mock.calls[0][0].where).toEqual({ id: "camp-1", orgId: "org-1" });

    mdb.campaign.findFirst.mockResolvedValue({ thumbnailUrl: bubble("f2"), thumbnailCopy: copy });
    expect(await readStoredCampaignThumbnail("camp-1", "org-1")).toBeNull();

    mdb.campaign.findFirst.mockResolvedValue({ thumbnailUrl: null, thumbnailCopy: copy });
    expect(await readStoredCampaignThumbnail("camp-1", "org-1")).toBeNull();
  });

  it("answers null before the table exists", async () => {
    mdb.campaign.findFirst.mockRejectedValue(missingTable());
    expect(await readStoredCampaignThumbnail("camp-1", "org-1")).toBeNull();
  });

  it("gives each campaign a version, marks a picture that would not download, and is empty on failure", async () => {
    mdb.campaignThumbnail.findMany.mockResolvedValue([
      { campaignId: "held", fetchedAt: new Date(NOW), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null },
      { campaignId: "moved", fetchedAt: new Date(NOW), sourceUrl: "https://x.cdn.bubble.io/f1/image.png", failedAt: null },
      { campaignId: "dead", fetchedAt: null, sourceUrl: "https://x.cdn.bubble.io/f9/image.png", failedAt: new Date(NOW) },
    ]);
    const states = await storedCampaignThumbnails(
      [
        { id: "held", thumbnailUrl: bubble("f1") },
        { id: "moved", thumbnailUrl: bubble("f2") },
        { id: "dead", thumbnailUrl: bubble("f9") },
        { id: "page", thumbnailUrl: "https://www.tiktok.com/music/x-1" },
      ],
      "org-1"
    );
    expect(states).toEqual(new Map([["held", { version: NOW }], ["dead", { dead: true }]]));
    expect(mdb.campaignThumbnail.findMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      campaignId: { in: ["held", "moved", "dead"] },
    });

    mdb.campaignThumbnail.findMany.mockRejectedValue(new Error("Can't reach database server"));
    expect(await storedCampaignThumbnails([{ id: "held", thumbnailUrl: bubble("f1") }], "org-1")).toEqual(new Map());
  });
});
