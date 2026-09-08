import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { db } from "@/lib/db";
import { computeCampaignPerformance, redactForShare } from "@/lib/reports/campaignPerformance";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import { rateLimit } from "@/lib/rateLimit";
import { getRequestIp } from "@/lib/request";

const SHARE_KIND = "campaign-performance";

/**
 * Rendering a PDF is the most expensive thing a token can ask for.
 *
 * The CSV export beside it has been rate limited since it shipped — same public
 * URL, same absent session, same walk-the-token-space risk — while this route,
 * which additionally boots react-pdf and lays out every post, had nothing. Same
 * key shape and same budget, so one control governs both.
 */
const RATE_LIMIT = { limit: 20, windowMs: 10 * 60 * 1000 };

/**
 * A large campaign lays out hundreds of rows, and the platform default cuts the
 * render off mid-document rather than answering slowly. Stated explicitly so it
 * does not move with a platform default nobody here chose.
 */
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const rl = rateLimit({ key: `share-pdf:${getRequestIp(req) ?? "unknown"}`, ...RATE_LIMIT });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

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

  const buffer = await renderToBuffer(
    React.createElement(CampaignPerformancePDF, {
      campaignTitle: link.campaign.title,
      data: redactForShare(performance, visibility),
      visibility,
      budget: visibility.showBudget ? link.campaign.budget : null,
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
