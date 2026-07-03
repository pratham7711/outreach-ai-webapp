import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { db } from "@/lib/db";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";

const SHARE_KIND = "campaign-performance";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const link = await db.report.findUnique({
    where: { shareToken: token },
    include: {
      campaign: { select: { id: true, orgId: true, title: true, budget: true, currency: true } },
    },
  });

  if (!link || !link.isPublic || !link.campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const config = (link.config as { kind?: string } | null) ?? {};
  if (config.kind !== SHARE_KIND) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const performance = await computeCampaignPerformance({
    id: link.campaign.id,
    orgId: link.campaign.orgId,
    budget: link.campaign.budget,
    currency: link.campaign.currency,
  });

  const buffer = await renderToBuffer(
    React.createElement(CampaignPerformancePDF, {
      campaignTitle: link.campaign.title,
      data: performance,
    }) as any
  );

  const stem = link.campaign.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${stem}-performance.pdf"`,
    },
  });
}
