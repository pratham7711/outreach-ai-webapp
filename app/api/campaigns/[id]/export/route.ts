import { NextRequest, NextResponse } from "next/server";
import React from "react";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";
import { computeCampaignEmv, emvLabel } from "@/lib/metrics";
import { emvEnabledFromRaw } from "@/lib/orgMetrics";
import {
  engagementRateValue,
  fieldMetricValue,
  rollupEngagement,
  unwrittenMetricValue,
} from "@/lib/metricDisplay";

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

    /* Scoped like the campaign detail: an export is the whole report in a file,
       so it cannot be reachable where the page it exports is not. */
    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
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

    /* A workspace that turned EMV off in Settings -> Metrics must not get it
       back through the export button. Same policy the share export and the
       posts-table CSV apply, read from the same place. */
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });
    const showEmv = emvEnabledFromRaw(org?.uiConfig);

    const performance = await computeCampaignPerformance(campaign);
    const stem = `${campaign.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign"}-export-${day(new Date())}`;

    if (format === "pdf") {
      const buffer = await renderToBuffer(
        React.createElement(CampaignPerformancePDF, {
          campaignTitle: campaign.title,
          data: showEmv
            ? performance
            : {
                ...performance,
                kpis: { ...performance.kpis, emv: null },
                leaderboard: performance.leaderboard.map((r) => ({ ...r, emv: null })),
              },
        }) as any
      );
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${stem}.pdf"`,
        },
      });
    }

    const [posts, activations] = await Promise.all([
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
          downloadsCount: true,
          engagementRate: true,
          lastSyncedAt: true,
          platformMetrics: true,
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
    ]);

    const { kpis } = performance;

    /* One distinct-creator set, used by the Summary count and the Creators
       sheet alike. They were two different answers: the count was
       activations.length while the sheet was the union of activation creators
       and post creators, so an imported campaign -- which has no activations at
       all -- reported "Creators 0" above a sheet listing fourteen of them. */
    const creatorIds = Array.from(
      new Set<string>([
        ...activations.map((a) => a.creator.id),
        ...posts.map((p) => p.creator.id),
      ])
    );

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

        ["Views", kpis.views],
        ["Engagements", kpis.engagements ?? ""],
        ["Engagement Rate %", kpis.engagementRate !== null ? +(kpis.engagementRate * 100).toFixed(2) : ""],

        ...(showEmv ? [[emvLabel(performance.currency), kpis.emv] as Cell[]] : []),
        ["Posts", posts.length],
        ["Creators", creatorIds.length],
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
        /* Provenance, the same way the Posts tab and the share export apply it:
           a counter nobody ever fetched is an empty cell, not a measured zero.
           Post.engagementRate is ALREADY a percent (lib/sync/syncPost writes it
           as one), so the x100 this row used to do printed 428% for a 4.28%
           post -- and disagreed with the Summary sheet directly above it. */
        ...posts.map((p) => {
          const likes = fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes");
          const comments = fieldMetricValue(
            p.commentsCount,
            p.lastSyncedAt,
            p.platformMetrics,
            "comments"
          );
          const rate =
            likes === null && comments === null
              ? null
              : engagementRateValue(p.likesCount, p.commentsCount, p.viewsCount, p.lastSyncedAt) ??
                p.engagementRate;
          return [
            day(p.postedAt),
            p.creator.name,
            p.creator.handle,
            p.platform,
            p.status,
            p.postUrl,
            // Views are always real -- every import carried them, so no
            // provenance test here, exactly as the share export does it.
            p.viewsCount,
            likes ?? "",
            comments ?? "",
            fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares") ?? "",
            // Nothing here writes saves, so a sync stamp does not vouch for a 0.
            unwrittenMetricValue(p.savesCount) ?? "",
            rate === null ? "" : +rate.toFixed(2),
          ] as Cell[];
        }),
      ],
    };

    const creatorRows = creatorIds.map((creatorId) => {
      const activation = activations.find((a) => a.creator.id === creatorId);
      const creatorPosts = posts.filter((p) => p.creator.id === creatorId);
      const meta = activation?.creator ?? creatorPosts[0].creator;
      const views = creatorPosts.reduce((s, p) => s + p.viewsCount, 0);
      /* rollupEngagement, not a bare sum: it is the product's one definition of
         the rate and it drops posts nobody measured from both the numerator and
         the denominator. Summing every post's counters here rated an imported
         creator at 0.0% against the dashboard's real figure. */
      const { engagements, rate } = rollupEngagement(creatorPosts);
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
        engagements ?? "",
        rate !== null ? +(rate * 100).toFixed(2) : "",
        ...(showEmv ? [emv] : []),
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
          ...(showEmv ? [emvLabel(performance.currency)] : []),
        ],
        ...creatorRows,
      ],
    };

    const sections = [summary, postSection, creatorSection];

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
