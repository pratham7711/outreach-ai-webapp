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
import { shareSoundCoverPath } from "@/lib/postMedia";

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

  /* Our own copy of the sound's cover (lib/sounds/coverStore), outside the
     report's cache like the post pictures: a copy taken after the report was
     cached must not wait out the entry. It replaces the audio's stored link,
     which TikTok signs with an expiry; artworkUrl stays the link chain, so the
     header still has a fallback if our copy cannot be served. */
  const soundId = link.campaign.song?.sound?.id;
  const coverVersion = soundId
    ? (await storedSoundCoverVersions([soundId], link.campaign.orgId)).get(soundId)
    : undefined;
  const withThumbnails = await withStoredShareThumbnails(redactForShare(performance, visibility), {
    token,
    orgId: link.campaign.orgId,
    showCreators: visibility.showCreators,
  });
  const data =
    withThumbnails.audio && coverVersion !== undefined
      ? { ...withThumbnails, audio: { ...withThumbnails.audio, coverUrl: shareSoundCoverPath(token, coverVersion) } }
      : withThumbnails;

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
        artworkUrl={campaignArtwork(link.campaign)}
        visibility={visibility}
        // Only reaches the client when the link is allowed to show it, so a
        // hidden budget is absent from the payload rather than merely unrendered.
        budget={visibility.showBudget ? link.campaign.budget : null}
      />
    </>
  );
}
