import React, { cache } from "react";
import type { Metadata } from "next";
import { Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { computeCampaignPerformance, redactForShare } from "@/lib/reports/campaignPerformance";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import SharedPerformanceReport from "./SharedPerformanceReport";

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
          org: { select: { name: true } },
        },
      },
    },
  })
);

function RevokedState() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--cc-bg)",
      }}
    >
      <div
        style={{
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 16,
          padding: "48px 32px",
          maxWidth: 420,
          textAlign: "center",
        }}
      >
        <div style={{ marginBottom: 16 }}><Link2 size={40} color="var(--cc-text-subtle)" /></div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 8px" }}>
          Link unavailable
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", margin: 0, lineHeight: 1.6 }}>
          This report link is no longer active. It may have been revoked or the address is
          incorrect.
        </p>
      </div>
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

  return (
    <SharedPerformanceReport
      token={token}
      campaignTitle={link.campaign.title}
      // Redacted here rather than in the component: props cross into the RSC
      // payload, so a conditionally-rendered leaderboard still publishes every
      // creator name to anyone who reads the HTML.
      data={redactForShare(performance, visibility)}
      campaignStatus={link.campaign.status}
      visibility={visibility}
      // Only reaches the client when the link is allowed to show it, so a
      // hidden budget is absent from the payload rather than merely unrendered.
      budget={visibility.showBudget ? link.campaign.budget : null}
    />
  );
}
