import React from "react";
import { db } from "@/lib/db";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
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
        <div style={{ fontSize: 40, marginBottom: 16 }}>🔗</div>
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

  const performance = await computeCampaignPerformance({
    id: link.campaign.id,
    orgId: link.campaign.orgId,
    budget: link.campaign.budget,
    currency: link.campaign.currency,
  });

  return (
    <SharedPerformanceReport
      token={token}
      campaignTitle={link.campaign.title}
      data={performance}
    />
  );
}
