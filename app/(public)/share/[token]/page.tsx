import React, { cache } from "react";
import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { computeCampaignPerformance, redactForShare } from "@/lib/reports/campaignPerformance";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import { CAMPAIGN_ARTWORK_INCLUDE, campaignArtwork } from "@/lib/campaignArtwork";
import SharedPerformanceReport from "./SharedPerformanceReport";
import { BRAND } from "@/lib/brand";
import { withStoredShareThumbnails } from "@/lib/posts/thumbnailStore";
import { storedSoundCoverVersions } from "@/lib/sounds/coverStore";
import { readSongSoundIds } from "@/lib/songs/songSounds";
import { shareArtworkPath, shareSoundCoverPath } from "@/lib/postMedia";
import { storedCampaignThumbnails } from "@/lib/campaigns/thumbnailCopy";
import { loadCampaignRules } from "@/lib/campaigns/rules";

const SHARE_KIND = "campaign-performance";

/**
 * generateMetadata and the page body both need the link, and both used to fetch
 * it -- two round trips to Singapore for one row, on every view. cache() is
 * request-scoped, so the second caller gets the first one's result and a revoked
 * link is still noticed on the very next request.
 */
const loadShareLink = cache((token: string) =>
  db.report.findUnique({
    where: { shareToken: token },
    include: {
      campaign: {
        select: {
          id: true,
          orgId: true,
          title: true,
          budget: true,
          currency: true,
          status: true,
          thumbnailUrl: true,
          songId: true,
          song: CAMPAIGN_ARTWORK_INCLUDE,
          org: { select: { name: true } },
        },
      },
    },
  })
);

/* The report's own frame -- its black page and top bar -- around the
   card, so a dead link still reads as the report a brand was sent rather than a
   bare white box on black. The name in the bar is ours, not an agency's: a
   revoked or mistyped token says nothing about whose report it was, and
   guessing would put one tenant's name on another's link. */
function RevokedState() {
  return (
    <div className="spr-root" style={{ display: "flex", flexDirection: "column" }}>
      <header className="spr-topbar">
        <div className="spr-wrap spr-topbar-in">
          <span className="spr-brand">{BRAND.name}</span>
        </div>
      </header>
      <main
        className="spr-wrap"
        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}
      >
        <div className="spr-card" style={{ padding: "48px 32px", maxWidth: 440, textAlign: "center" }}>
          <div style={{ marginBottom: 16 }}><Link2 size={40} color="var(--spr-label)" aria-hidden="true" /></div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--spr-ink)", margin: "0 0 8px" }}>
            Link unavailable
          </h1>
          <p style={{ fontSize: 14, color: "var(--spr-ink-muted)", margin: 0, lineHeight: 1.6 }}>
            This report link is no longer active. It may have been revoked, or the address may be
            incomplete. Ask whoever sent it to share a new link.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * The tab title is the campaign and the tenant, the way CreatorCore's client
 * report names itself -- "Wherever I go - Ellie Holcomb | LKay Media". A brand
 * with three of these links open otherwise sees three identical tabs carrying
 * the name of our product instead of the campaign they asked about.
 *
 * Deliberately not indexed: the link is unlisted, and the whole point is that it
 * is shared deliberately rather than found.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const link = await loadShareLink(token);

  const robots = { index: false, follow: false };
  if (!link?.isPublic || !link.campaign) return { title: "Report unavailable", robots };

  const org = link.campaign.org?.name;
  return {
    title: org ? `${link.campaign.title} | ${org}` : link.campaign.title,
    description: `Campaign performance report for ${link.campaign.title}.`,
    robots,
  };
}

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await loadShareLink(token);

  if (!link || !link.isPublic || !link.campaign) return <RevokedState />;

  const config = (link.config as { kind?: string } | null) ?? {};
  if (config.kind !== SHARE_KIND) return <RevokedState />;

  const visibility = parseShareVisibility(link.config);

  const performance = await computeCampaignPerformance(
    {
      id: link.campaign.id,
      orgId: link.campaign.orgId,
      budget: link.campaign.budget,
      currency: link.campaign.currency,
    },
    visibility.platforms
  );

  /* Our own copies of the sound's cover (lib/sounds/coverStore) and of the
     campaign's picture (lib/campaigns/thumbnailCopy), outside the report's
     cache like the post pictures: a copy taken after the report was cached
     must not wait out the entry. The sound's copy replaces the audio's stored
     link, which TikTok signs with an expiry; artworkUrl prefers either copy
     and keeps the links behind them, so the header still has a fallback if a
     copy cannot be served. */
  const campaign = link.campaign;
  /* The sound in the song's first slot leads the header (campaignArtwork);
     the two cards each take their own sound's copy. On an older song whose
     only sound is an Instagram audio, that one sound is both. */
  const soundId = campaign.song?.sound?.id;
  const songSounds = await readSongSoundIds(campaign.orgId, campaign.songId);
  const coverIds = [...new Set([soundId, songSounds.tiktok, songSounds.instagram].filter((id): id is string => !!id))];
  const [coverVersions, thumbnailCopy] = await Promise.all([
    coverIds.length ? storedSoundCoverVersions(coverIds, campaign.orgId) : new Map<string, number>(),
    storedCampaignThumbnails([campaign], campaign.orgId).then((m) => m.get(campaign.id)),
  ]);
  const coverVersion = soundId ? coverVersions.get(soundId) : undefined;
  const coverPath = (id: string | null): string | null => {
    const version = id ? coverVersions.get(id) : undefined;
    if (!id || version === undefined) return null;
    return id === soundId ? shareSoundCoverPath(token, version) : shareSoundCoverPath(token, version, "instagram");
  };
  const withThumbnails = await withStoredShareThumbnails(redactForShare(performance, visibility), {
    token,
    orgId: link.campaign.orgId,
    showCreators: visibility.showCreators,
  });
  /* The checklist and view goal, read only when the link may show them, so a
     link without the switch carries none of it in its payload. */
  const rules = visibility.showBrief ? await loadCampaignRules(campaign.id, campaign.orgId) : null;
  const brief = rules
    ? { dos: rules.dos, donts: rules.donts, examples: rules.examplePostUrls, viewGoal: rules.viewGoal }
    : null;
  const audioCover = withThumbnails.audio ? coverPath(songSounds.tiktok) : null;
  const instagramCover = withThumbnails.instagramAudio ? coverPath(songSounds.instagram) : null;
  const data = {
    ...withThumbnails,
    ...(withThumbnails.audio && audioCover ? { audio: { ...withThumbnails.audio, coverUrl: audioCover } } : {}),
    ...(withThumbnails.instagramAudio && instagramCover
      ? { instagramAudio: { ...withThumbnails.instagramAudio, coverUrl: instagramCover } }
      : {}),
  };

  return (
    <>
      <SharedPerformanceReport
        token={token}
        campaignTitle={link.campaign.title}
        orgName={link.campaign.org?.name ?? null}
        // Redacted here rather than in the component: props cross into the RSC
        // payload, so a conditionally-rendered leaderboard still publishes every
        // creator name to anyone who reads the HTML.
        data={data}
        campaignStatus={link.campaign.status}
        // The audio's cover leads the header; this is what stands in when the
        // campaign has no tracked sound, the same picture the campaigns list shows.
        artworkUrl={campaignArtwork(link.campaign, {
          thumbnail: thumbnailCopy?.version !== undefined ? shareArtworkPath(token, thumbnailCopy.version) : null,
          thumbnailDead: thumbnailCopy?.dead ?? false,
          soundCover: coverVersion !== undefined ? shareSoundCoverPath(token, coverVersion) : null,
        })}
        visibility={visibility}
        // Only reaches the client when the link is allowed to show it, so a
        // hidden budget is absent from the payload rather than merely unrendered.
        budget={visibility.showBudget ? link.campaign.budget : null}
        brief={brief}
      />
    </>
  );
}
