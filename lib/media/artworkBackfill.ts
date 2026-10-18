import { db } from "@/lib/db";
import { isFetchableAvatarUrl as isFetchableImageUrl } from "@/lib/creators/avatarStore";
import { isProxyableHost } from "@/lib/postMedia";
import { linkKey, pictureKey, pictureLink } from "@/lib/campaigns/pictureLink";
import { CAMPAIGN_THUMBNAIL_RETRY_MS, captureCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";
import { SOUND_COVER_RETRY_MS, captureSoundCover } from "@/lib/sounds/coverStore";

/**
 * Copies the artwork that existed before the stores did: every sound's cover
 * (SoundCover) and every campaign's picture (CampaignThumbnail) with a link
 * that still draws. From then on readings and saves keep them current; this is
 * for the backlog, and for checking on it.
 *
 * Every org, by design -- it runs from an admin route, never a request. Each
 * capture reads its own row for the org it files under, so nothing here
 * decides a tenant.
 */
export type ArtworkBackfillOptions = {
  dryRun: boolean;
  /** Items this batch, sounds first. */
  limit?: number;
  /** Include items whose link failed within the retry window. */
  retryFailed?: boolean;
  /** Stop starting new work after this long; the route has 60s. */
  budgetMs?: number;
  concurrency?: number;
};

type Counts = { total: number; held: number; noPicture: number; failedRecently: number; toTry: number };

export type ArtworkBackfillResult = {
  dryRun: boolean;
  sounds: Counts & { stored: number; failed: number };
  campaigns: Counts & { stored: number; failed: number };
  remaining: number;
  ms: number;
};

function proxyable(url: string): boolean {
  try {
    return isProxyableHost(new URL(url).host);
  } catch {
    return false;
  }
}

export async function backfillArtwork(options: ArtworkBackfillOptions): Promise<ArtworkBackfillResult> {
  const started = Date.now();
  const now = started;
  const deadline = started + (options.budgetMs ?? 45_000);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 200) || 200, 1), 1000);
  const concurrency = Math.min(Math.max(Math.floor(options.concurrency ?? 4) || 4, 1), 8);

  const sounds = await db.tikTokSound.findMany({
    select: {
      id: true,
      coverImageUrl: true,
      songs: { select: { coverUrl: true } },
      cover: { select: { fetchedAt: true, sourceUrl: true, failedAt: true } },
    },
    orderBy: { id: "asc" },
  });
  const soundCounts: Counts = { total: sounds.length, held: 0, noPicture: 0, failedRecently: 0, toTry: 0 };
  const soundWork: { id: string; candidates: string[] }[] = [];
  for (const s of sounds) {
    if (s.cover?.fetchedAt) {
      soundCounts.held++;
      continue;
    }
    const candidates = [s.coverImageUrl, ...s.songs.map((song) => song.coverUrl)].filter(
      (u): u is string => isFetchableImageUrl(u, now) && proxyable(u)
    );
    if (!candidates.length) {
      soundCounts.noPicture++;
      continue;
    }
    // Waiting only when every link it has is the one that just failed, as captureSoundCover does.
    const failedLink = s.cover?.failedAt && now - s.cover.failedAt.getTime() < SOUND_COVER_RETRY_MS ? linkKey(s.cover.sourceUrl) : null;
    if (!options.retryFailed && failedLink !== null && candidates.every((u) => linkKey(u) === failedLink)) {
      soundCounts.failedRecently++;
      continue;
    }
    soundCounts.toTry++;
    soundWork.push({ id: s.id, candidates });
  }

  const campaigns = await db.campaign.findMany({
    where: { deletedAt: null, thumbnailUrl: { not: null } },
    select: {
      id: true,
      thumbnailUrl: true,
      thumbnailCopy: { select: { fetchedAt: true, sourceUrl: true, failedAt: true } },
    },
    orderBy: { id: "asc" },
  });
  const campaignCounts: Counts = { total: campaigns.length, held: 0, noPicture: 0, failedRecently: 0, toTry: 0 };
  const campaignWork: string[] = [];
  for (const c of campaigns) {
    const link = pictureLink(c.thumbnailUrl);
    const key = pictureKey(link);
    const row = c.thumbnailCopy;
    if (row?.fetchedAt && key !== null && pictureKey(row.sourceUrl) === key) {
      campaignCounts.held++;
      continue;
    }
    if (!link || !isFetchableImageUrl(link, now) || !proxyable(link)) {
      campaignCounts.noPicture++;
      continue;
    }
    if (
      !options.retryFailed &&
      !row?.fetchedAt &&
      row?.failedAt &&
      linkKey(row.sourceUrl) === linkKey(link) &&
      now - row.failedAt.getTime() < CAMPAIGN_THUMBNAIL_RETRY_MS
    ) {
      campaignCounts.failedRecently++;
      continue;
    }
    campaignCounts.toTry++;
    campaignWork.push(c.id);
  }

  const result: ArtworkBackfillResult = {
    dryRun: options.dryRun,
    sounds: { ...soundCounts, stored: 0, failed: 0 },
    campaigns: { ...campaignCounts, stored: 0, failed: 0 },
    remaining: soundWork.length + campaignWork.length,
    ms: 0,
  };
  if (options.dryRun) {
    result.ms = Date.now() - started;
    return result;
  }

  type Job = { kind: "sound"; id: string; candidates: string[] } | { kind: "campaign"; id: string };
  const jobs: Job[] = [
    ...soundWork.map((s) => ({ kind: "sound" as const, ...s })),
    ...campaignWork.map((id) => ({ kind: "campaign" as const, id })),
  ].slice(0, limit);

  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < jobs.length && Date.now() < deadline) {
      const job = jobs[next++];
      if (job.kind === "sound") {
        const kept = await captureSoundCover(job.id, job.candidates, Date.now());
        if (kept) result.sounds.stored++;
        else result.sounds.failed++;
      } else {
        const outcome = await captureCampaignThumbnail(job.id, Date.now(), { retryFailed: options.retryFailed });
        if (outcome === "stored" || outcome === "held") result.campaigns.stored++;
        else result.campaigns.failed++;
      }
      done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(jobs.length, 1)) }, worker));

  result.remaining = soundWork.length + campaignWork.length - done;
  result.ms = Date.now() - started;
  return result;
}
