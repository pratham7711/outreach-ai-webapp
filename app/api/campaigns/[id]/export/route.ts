import { NextRequest, NextResponse } from "next/server";
import React from "react";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";
import { computeCampaignEmv, computeEngagementRate, sumEngagements } from "@/lib/metrics";

type Format = "xlsx" | "csv" | "pdf";
type Cell = string | number;
type Section = { name: string; rows: Cell[][] };

const FORMATS: Format[] = ["xlsx", "csv", "pdf"];

function day(d: Date | null | undefined): string {
  return d ? d.toISOString().split("T")[0] : "";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const format = (req.nextUrl.searchParams.get("format") || "xlsx").toLowerCase() as Format;
    if (!FORMATS.includes(format)) {
      return NextResponse.json(
        { error: "Invalid format. Must be xlsx, csv, or pdf." },
        { status: 400 }
      );
    }

    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      select: {
        id: true,
        orgId: true,
        title: true,
        status: true,
        budget: true,
        currency: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const performance = await computeCampaignPerformance(campaign);
    const stem = `${campaign.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-export-${day(new Date())}`;

    if (format === "pdf") {
      const buffer = await renderToBuffer(
        React.createElement(CampaignPerformancePDF, {
          campaignTitle: campaign.title,
          data: performance,
        }) as any
      );
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${stem}.pdf"`,
        },
      });
    }

    const [posts, activations, payouts] = await Promise.all([
      db.post.findMany({
        where: { campaignId: campaign.id, campaign: { orgId } },
        select: {
          platform: true,
          postUrl: true,
          postedAt: true,
          status: true,
          viewsCount: true,
          likesCount: true,
          commentsCount: true,
          sharesCount: true,
          savesCount: true,
          engagementRate: true,
          creator: { select: { id: true, name: true, handle: true, platform: true } },
        },
        orderBy: { postedAt: "desc" },
      }),
      db.activation.findMany({
        where: { campaignId: campaign.id, campaign: { orgId }, deletedAt: null },
        select: {
          status: true,
          deliverableDueDate: true,
          creator: { select: { id: true, name: true, handle: true, platform: true } },
        },
      }),
      db.payout.findMany({
        where: { orgId, campaignId: campaign.id },
        select: {
          createdAt: true,
          amount: true,
          currency: true,
          status: true,
          paymentMethod: true,
          transactionId: true,
          completedAt: true,
          creator: { select: { name: true, handle: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const { kpis } = performance;
    const paidTotal = payouts
      .filter((p) => p.status === "SUCCESS")
      .reduce((s, p) => s + p.amount, 0);

    const summary: Section = {
      name: "Summary",
      rows: [
        ["Campaign Export", campaign.title],
        ["Generated At", new Date().toISOString()],
        [],
        ["Field", "Value"],
        ["Campaign", campaign.title],
        ["Client", campaign.client?.name ?? ""],
        ["Status", campaign.status],
        ["Created", day(campaign.createdAt)],
        ["Currency", performance.currency],
        ["Budget", campaign.budget ?? ""],
        ["Spend", kpis.spend],
        ["Spend Source", performance.spendSource],
        ["Paid Payouts", paidTotal],
        ["Views", kpis.views],
        ["Engagements", kpis.engagements],
        ["Engagement Rate %", kpis.engagementRate !== null ? +(kpis.engagementRate * 100).toFixed(2) : ""],
        ["CPM", kpis.cpm ?? ""],
        ["CPE", kpis.cpe ?? ""],
        ["EMV", kpis.emv],
        ["Posts", posts.length],
        ["Creators", activations.length],
        [],
        ["Platform", "Posts", "Views"],
        ...performance.platformSplit.map((p) => [p.platform, p.posts, p.views] as Cell[]),
      ],
    };

    const postSection: Section = {
      name: "Posts",
      rows: [
        [
          "Posted At",
          "Creator",
          "Handle",
          "Platform",
          "Status",
          "URL",
          "Views",
          "Likes",
          "Comments",
          "Shares",
          "Saves",
          "Engagement Rate %",
        ],
        ...posts.map((p) => [
          day(p.postedAt),
          p.creator.name,
          p.creator.handle,
          p.platform,
          p.status,
          p.postUrl,
          p.viewsCount,
          p.likesCount,
          p.commentsCount,
          p.sharesCount,
          p.savesCount,
          +(p.engagementRate * 100).toFixed(2),
        ] as Cell[]),
      ],
    };

    const paidByCreator = new Map<string, number>();
    for (const p of payouts) {
      if (p.status !== "SUCCESS") continue;
      const key = p.creator.handle;
      paidByCreator.set(key, (paidByCreator.get(key) ?? 0) + p.amount);
    }

    const creatorIds = new Set<string>([
      ...activations.map((a) => a.creator.id),
      ...posts.map((p) => p.creator.id),
    ]);
    const creatorRows = Array.from(creatorIds).map((creatorId) => {
      const activation = activations.find((a) => a.creator.id === creatorId);
      const creatorPosts = posts.filter((p) => p.creator.id === creatorId);
      const meta = activation?.creator ?? creatorPosts[0].creator;
      const views = creatorPosts.reduce((s, p) => s + p.viewsCount, 0);
      const engagements = creatorPosts.reduce(
        (s, p) =>
          s +
          sumEngagements({
            likes: p.likesCount,
            comments: p.commentsCount,
            shares: p.sharesCount,
            saves: p.savesCount,
          }),
        0
      );
      const rate = views > 0 ? computeEngagementRate({ views, likes: engagements }) : null;
      const emv = computeCampaignEmv(
        creatorPosts.map((p) => ({
          platform: p.platform,
          views: p.viewsCount,
          likes: p.likesCount,
          comments: p.commentsCount,
          shares: p.sharesCount,
          saves: p.savesCount,
        }))
      );
      return [
        meta.name,
        meta.handle,
        meta.platform,
        activation?.status ?? "",
        day(activation?.deliverableDueDate),
        creatorPosts.length,
        views,
        engagements,
        rate !== null ? +(rate * 100).toFixed(2) : "",
        emv,
        paidByCreator.get(meta.handle) ?? 0,
      ] as Cell[];
    });
    creatorRows.sort((a, b) => Number(b[6]) - Number(a[6]));

    const creatorSection: Section = {
      name: "Creators",
      rows: [
        [
          "Creator",
          "Handle",
          "Platform",
          "Activation Status",
          "Due Date",
          "Posts",
          "Views",
          "Engagements",
          "Engagement Rate %",
          "EMV",
          "Paid",
        ],
        ...creatorRows,
      ],
    };

    const payoutSection: Section = {
      name: "Payouts",
      rows: [
        [
          "Created",
          "Completed",
          "Creator",
          "Handle",
          "Amount",
          "Currency",
          "Status",
          "Payment Method",
          "Transaction ID",
        ],
        ...payouts.map((p) => [
          day(p.createdAt),
          day(p.completedAt),
          p.creator.name,
          p.creator.handle,
          p.amount,
          p.currency,
          p.status,
          p.paymentMethod,
          p.transactionId ?? "",
        ] as Cell[]),
      ],
    };

    const sections = [summary, postSection, creatorSection, payoutSection];

    if (format === "csv") {
      const csv = sections
        .map((s) => `${s.name}\n${XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(s.rows))}`)
        .join("\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${stem}.csv"`,
        },
      });
    }

    const wb = XLSX.utils.book_new();
    for (const s of sections) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
    }
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${stem}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("Campaign export error:", error);
    return NextResponse.json({ error: "Failed to export campaign data" }, { status: 500 });
  }
}
