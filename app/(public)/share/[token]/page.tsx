import React from "react";
import { Link2 } from "lucide-react";
import { db } from "@/lib/db";
import { computeCampaignPerformance, redactForShare } from "@/lib/reports/campaignPerformance";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import SharedPerformanceReport from "./SharedPerformanceReport";

const SHARE_KIND = "campaign-performance";

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

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await db.report.findUnique({
    where: { shareToken: token },
    include: {
      campaign: { select: { id: true, orgId: true, title: true, budget: true, currency: true } },
    },
  });

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
      visibility={visibility}
      // Only reaches the client when the link is allowed to show it, so a
      // hidden budget is absent from the payload rather than merely unrendered.
      budget={visibility.showBudget ? link.campaign.budget : null}
    />
  );
}
