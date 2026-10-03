import { NextRequest, NextResponse } from "next/server";
import React from "react";
import * as XLSX from "xlsx";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";
import {
  engagementRateValue,
  fieldMetricValue,
  rollupEngagement,
  unwrittenMetricValue,
} from "@/lib/metricDisplay";
import { UNKNOWN } from "@/lib/format";
import { asOfCell, dataAsOf } from "@/lib/dataAge";
import { postMeasuredAt, postStatus, postStatusSummary } from "@/lib/posts/postStatus";

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
          lastFreshAt: true,
          fetchState: true,
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
        /* The newest reading behind these figures (plan A6). Generated At is
           when the file was made; this is how fresh what is in it is. Each
           post row carries its own As of. */
        ["Data as of", asOfCell(dataAsOf(posts.map((p) => postMeasuredAt(p).at)))],
        [],
        ["Field", "Value"],
        ["Campaign", campaign.title],
        ["Client", campaign.client?.name ?? ""],
        ["Status", campaign.status],
        ["Created", day(campaign.createdAt)],
        ["Currency", performance.currency],
        ["Budget", campaign.budget ?? ""],

        ["Views", kpis.views],
        ["Engagements", kpis.engagements ?? UNKNOWN],
        ["Engagement Rate %", kpis.engagementRate !== null ? +(kpis.engagementRate * 100).toFixed(2) : UNKNOWN],

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
          /* Appended, so every column a saved import reads by position stays
             where it was (plan A2/A5): when the counters were read, by what,
             and whether the post is still up. */
          "As of",
          "Source",
          "Post status",
        ],
        /* Provenance, the same way the Posts tab and the share export apply it:
           a counter nobody ever fetched is "—" (lib/creators/metricValue's
           export rule), never a measured zero and never a blank.
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
          /* No fallback to the stored column: it holds CreatorCore's fraction on
             imported rows and a percent on synced ones (see postEngagementPercent),
             so a post with no views to divide by has no rate, not that one. */
          const rate =
            likes === null
              ? null
              : engagementRateValue(p.likesCount, p.commentsCount, p.viewsCount, p.lastSyncedAt);
          const measured = postMeasuredAt(p);
          return [
            day(p.postedAt),
            p.creator.name,
            p.creator.handle,
            p.platform,
            p.status,
            p.postUrl,
            // Not "always real": an import carried a views figure lower than
            // the post's likes on 191 TikTok videos, and those are now held as
            // unknown. A dash, as for every other counter nobody measured.
            fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") ?? UNKNOWN,
            likes ?? UNKNOWN,
            comments ?? UNKNOWN,
            fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares") ?? UNKNOWN,
            // Nothing here writes saves, so a sync stamp does not vouch for a 0.
            unwrittenMetricValue(p.savesCount) ?? UNKNOWN,
            rate === null ? UNKNOWN : +rate.toFixed(2),
            asOfCell(measured.at),
            measured.source,
            postStatus(p).label,
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
      return [
        meta.name,
        meta.handle,
        meta.platform,
        activation?.status ?? "",
        day(activation?.deliverableDueDate),
        creatorPosts.length,
        views,
        engagements ?? UNKNOWN,
        rate !== null ? +(rate * 100).toFixed(2) : UNKNOWN,
        // The newest read among their posts, and what their posts' statuses are.
        asOfCell(dataAsOf(creatorPosts.map((p) => postMeasuredAt(p).at))),
        creatorPosts.length ? "Campaign posts" : UNKNOWN,
        postStatusSummary(creatorPosts.map((p) => postStatus(p))),
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
          "As of",
          "Source",
          "Post status",
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
