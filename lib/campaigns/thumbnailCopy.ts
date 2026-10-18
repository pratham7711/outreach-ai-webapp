import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { createLogger } from "@/lib/observability/logger";
import { isFetchableAvatarUrl as isFetchableImageUrl } from "@/lib/creators/avatarStore";
import { isProxyableHost } from "@/lib/postMedia";
import { linkKey, pictureKey, pictureLink } from "@/lib/campaigns/pictureLink";
import { describeImageLink } from "@/lib/sounds/coverStore";

/**
 * A campaign's picture, kept as bytes (CampaignThumbnail).
 *
 * Campaign.thumbnailUrl is a link to somebody else's server. Measured
 * 2026-10-18 across one tenant's 545 campaigns, 18 of the 528 links drew
 * nothing: CreatorCore uploads that are gone, TikTok covers signed to expire,
 * and TikTok music pages and YouTube videos saved where a picture belongs.
 * The other 510 drew -- for as long as the servers behind them keep them.
 *
 * So the picture is downloaded once, shrunk to an AVIF and kept, against the
 * link it came from. It is shown only while the campaign still points at that
 * picture: change or clear the thumbnail and the old copy simply stops
 * matching. Same contract as SoundCover (lib/sounds/coverStore), PostThumbnail
 * and CreatorAvatar.
 */

/** The largest surface is the client report's header, which asks for 302 (served from the 384 box). */
export const CAMPAIGN_THUMBNAIL_STORE_PX = 384;
export const CAMPAIGN_THUMBNAIL_FETCH_TIMEOUT_MS = 5_000;
/** A link that would not download is asked for again after this. */
export const CAMPAIGN_THUMBNAIL_RETRY_MS = 6 * 60 * 60 * 1000;

/** Prisma's "table does not exist" -- the DDL has not been applied yet. */
export function isMissingCampaignThumbnailTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /CampaignThumbnail.*does not exist|relation "CampaignThumbnail"/i.test(message);
}

type CopyRow = { fetchedAt: Date | null; sourceUrl: string | null; failedAt: Date | null };

/** Whether a row holds a copy of the picture the campaign points at now. */
function holdsCurrent(row: CopyRow | null | undefined, thumbnailUrl: string | null | undefined): boolean {
  const key = pictureKey(pictureLink(thumbnailUrl));
  return Boolean(row?.fetchedAt && key !== null && pictureKey(row.sourceUrl) === key);
}

/** Whether the picture the campaign points at failed to download, and nothing is held. */
function failedCurrent(row: CopyRow | null | undefined, thumbnailUrl: string | null | undefined): boolean {
  const key = linkKey(pictureLink(thumbnailUrl));
  return Boolean(!row?.fetchedAt && row?.failedAt && key !== null && linkKey(row.sourceUrl) === key);
}

export type StoredCampaignThumbnail = { data: Uint8Array; fetchedAt: Date | null };

/**
 * The stored picture for one campaign in one org, or null: no copy, a copy of
 * a picture the campaign no longer points at, or no table yet.
 */
export async function readStoredCampaignThumbnail(
  campaignId: string,
  orgId: string
): Promise<StoredCampaignThumbnail | null> {
  try {
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId },
      select: {
        thumbnailUrl: true,
        thumbnailCopy: { select: { data: true, fetchedAt: true, sourceUrl: true, failedAt: true } },
      },
    });
    const row = campaign?.thumbnailCopy;
    if (!row?.data || !holdsCurrent(row, campaign?.thumbnailUrl)) return null;
    return { data: row.data, fetchedAt: row.fetchedAt };
  } catch (e) {
    if (isMissingCampaignThumbnailTable(e)) return null;
    throw e;
  }
}

export type CampaignThumbnailState = { version?: number; dead?: boolean };

/**
 * For each campaign: the version of a held copy of its current picture, or
 * `dead` when that picture would not download and nothing is held -- which a
 * page uses to skip a link it already knows draws nothing.
 *
 * Never throws: artwork is decoration, and on any error the page falls back to
 * the links, which is how it behaved before this store.
 */
export async function storedCampaignThumbnails(
  campaigns: { id: string; thumbnailUrl?: string | null }[],
  orgId: string
): Promise<Map<string, CampaignThumbnailState>> {
  const out = new Map<string, CampaignThumbnailState>();
  const withPicture = campaigns.filter((c) => c.id && pictureLink(c.thumbnailUrl));
  if (!withPicture.length) return out;
  try {
    const rows = await db.campaignThumbnail.findMany({
      where: { orgId, campaignId: { in: [...new Set(withPicture.map((c) => c.id))] } },
      select: { campaignId: true, fetchedAt: true, sourceUrl: true, failedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.campaignId, r]));
    for (const c of withPicture) {
      const row = byId.get(c.id);
      if (holdsCurrent(row, c.thumbnailUrl)) out.set(c.id, { version: row?.fetchedAt?.getTime() ?? 0 });
      else if (failedCurrent(row, c.thumbnailUrl)) out.set(c.id, { dead: true });
    }
  } catch (e) {
    if (!isMissingCampaignThumbnailTable(e)) {
      createLogger({ context: { module: "campaigns/thumbnailCopy" } }).warn("campaign thumbnails unavailable", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

export type CampaignThumbnailStoreResult = { stored: true; bytes: number } | { stored: false; failure: string };

/**
 * Download one link and keep it. A failure never erases a copy already held;
 * with nothing held, the failed link goes into sourceUrl so the retry wait and
 * `dead` know which picture failed.
 */
export async function storeCampaignThumbnailFromUrl(
  campaign: { id: string; orgId: string },
  url: string,
  options: { timeoutMs?: number; holding?: boolean } = {}
): Promise<CampaignThumbnailStoreResult> {
  const loaded = await loadImage(url, CAMPAIGN_THUMBNAIL_STORE_PX, CAMPAIGN_THUMBNAIL_STORE_PX, "campaigns/thumbnailCopy", {
    fit: "inside",
    timeoutMs: options.timeoutMs ?? CAMPAIGN_THUMBNAIL_FETCH_TIMEOUT_MS,
    format: "avif",
  });
  try {
    // Our own AVIF only, as for sounds: the CDN's raw bytes are neither bounded nor universally decodable.
    if (loaded.ok && loaded.contentType === "image/avif") {
      const now = new Date();
      const data = new Uint8Array(loaded.body);
      await db.campaignThumbnail.upsert({
        where: { campaignId: campaign.id },
        create: { campaignId: campaign.id, orgId: campaign.orgId, data, sourceUrl: url, fetchedAt: now },
        update: { data, sourceUrl: url, fetchedAt: now, failedAt: null, failure: null },
      });
      return { stored: true, bytes: data.byteLength };
    }
    const failure = loaded.ok ? `not transcoded (${loaded.contentType})` : loaded.message;
    await db.campaignThumbnail.upsert({
      where: { campaignId: campaign.id },
      create: { campaignId: campaign.id, orgId: campaign.orgId, sourceUrl: url, failedAt: new Date(), failure },
      update: { failedAt: new Date(), failure, ...(options.holding ? {} : { sourceUrl: url }) },
    });
    return { stored: false, failure };
  } catch (e) {
    if (isMissingCampaignThumbnailTable(e)) return { stored: false, failure: "table missing" };
    throw e;
  }
}

export type CampaignThumbnailCapture = "stored" | "held" | "skipped" | "failed";

/**
 * Keep a copy of the picture a campaign points at, if there is something new
 * to keep: nothing held, or the campaign now points at a different picture.
 * Reads the campaign's own row for its org and current link, so a caller
 * cannot file a picture under the wrong tenant or keep one the campaign has
 * already moved off.
 *
 * Never throws: saving a campaign must not fail over its picture.
 */
export async function captureCampaignThumbnail(
  campaignId: string,
  nowMs = Date.now(),
  options: { retryFailed?: boolean } = {}
): Promise<CampaignThumbnailCapture> {
  const log = createLogger({ context: { module: "campaigns/thumbnailCopy" } });
  const started = Date.now();
  try {
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: {
        orgId: true,
        thumbnailUrl: true,
        thumbnailCopy: { select: { fetchedAt: true, sourceUrl: true, failedAt: true } },
      },
    });
    if (!campaign) return "skipped";
    const url = pictureLink(campaign.thumbnailUrl);
    if (!url || !isFetchableImageUrl(url, nowMs)) return "skipped";
    // The download goes through loadImage's host allowlist; a link outside it can only fail.
    if (!isProxyableHost(new URL(url).host)) return "skipped";

    const row = campaign.thumbnailCopy;
    if (holdsCurrent(row, campaign.thumbnailUrl)) return "held";
    if (
      !options.retryFailed &&
      failedCurrent(row, campaign.thumbnailUrl) &&
      row?.failedAt &&
      nowMs - row.failedAt.getTime() < CAMPAIGN_THUMBNAIL_RETRY_MS
    ) {
      return "skipped";
    }

    const result = await storeCampaignThumbnailFromUrl({ id: campaignId, orgId: campaign.orgId }, url, {
      holding: Boolean(row?.fetchedAt),
    });
    log.info("campaign thumbnail capture", {
      campaignId,
      stored: result.stored,
      link: describeImageLink(url),
      ...(result.stored ? { bytes: result.bytes } : { failure: result.failure }),
      ms: Date.now() - started,
    });
    return result.stored ? "stored" : "failed";
  } catch (e) {
    if (!isMissingCampaignThumbnailTable(e)) {
      log.warn("campaign thumbnail capture failed", { campaignId, error: e instanceof Error ? e.message : String(e) });
    }
    return "failed";
  }
}
