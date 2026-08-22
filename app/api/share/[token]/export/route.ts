import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import { rateLimit } from "@/lib/rateLimit";
import { getRequestIp } from "@/lib/request";
import { fieldMetricValue, unwrittenMetricValue } from "@/lib/metricDisplay";

/**
 * GET /api/share/[token]/export — the post list behind a shared report, as CSV.
 *
 * CreatorCore's client report carries an "Export Posts" control, so a brand can
 * take the numbers into its own spreadsheet without asking the agency. Ours had
 * the report but not the export.
 *
 * The token is the entire authorisation, exactly as for the page it belongs to,
 * so this route repeats that page's rules rather than inventing softer ones:
 *
 *  - the same token lookup, the same kind check, the same revoked handling;
 *  - the same visibility flags, so a link that hides creators exports no creator
 *    names and a link that hides EMV exports no EMV column;
 *  - the same provenance rule, so a counter no post has measured comes out as an
 *    empty cell rather than a zero a brand would read as a measurement.
 */

const SHARE_KIND = "campaign-performance";

/** Quote only when needed, and never let a value break the row. */
function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: (string | number | null)[][]): string {
  // CRLF and a BOM, because these land in Excel more often than anywhere else
  // and Excel reads a plain UTF-8 CSV as Latin-1 without one.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // A public URL with no session behind it, so the shape of the campaign is
  // worth protecting from someone walking the token space with a script.
  const rl = rateLimit({ key: `share-export:${getRequestIp(request) ?? "unknown"}`, limit: 20, windowMs: 10 * 60 * 1000 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: {
      isPublic: true,
      config: true,
      campaign: { select: { id: true, title: true, currency: true } },
    },
  });

  if (!link?.isPublic || !link.campaign) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }
  const config = (link.config as { kind?: string } | null) ?? {};
  if (config.kind !== SHARE_KIND) {
    return NextResponse.json({ error: "This link is no longer available" }, { status: 404 });
  }

  const visibility = parseShareVisibility(link.config);

  const posts = await db.post.findMany({
    where: {
      campaignId: link.campaign.id,
      ...(visibility.platforms.length && { platform: { in: visibility.platforms as unknown as never } }),
    },
    select: {
      platform: true,
      postUrl: true,
      postedAt: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
      downloadsCount: true,
      lastSyncedAt: true,
      platformMetrics: true,
      creator: { select: { name: true, handle: true } },
    },
    orderBy: { viewsCount: "desc" },
  });

  const header: string[] = [
    ...(visibility.showCreators ? ["Creator", "Handle"] : []),
    "Platform",
    "Posted",
    "Post URL",
    "Views",
    "Likes",
    "Comments",
    "Shares",
    "Saves",
    "Downloads",
    "Last synced",
  ];

  const rows: (string | number | null)[][] = [
    header,
    ...posts.map((p) => [
      ...(visibility.showCreators ? [p.creator.name, p.creator.handle ? `@${p.creator.handle.replace(/^@/, "")}` : ""] : []),
      p.platform,
      p.postedAt ? p.postedAt.toISOString().slice(0, 10) : "",
      p.postUrl,
      p.viewsCount,
      fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes"),
      fieldMetricValue(p.commentsCount, p.lastSyncedAt, p.platformMetrics, "comments"),
      fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares"),
      // Nothing here writes these two, so a sync's timestamp does not vouch for
      // their zeroes the way it does for the columns above.
      unwrittenMetricValue(p.savesCount),
      unwrittenMetricValue(p.downloadsCount),
      p.lastSyncedAt ? p.lastSyncedAt.toISOString() : "",
    ]),
  ];

  const slug = link.campaign.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "campaign";

  return new NextResponse(csv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-posts.csv"`,
      // An unlisted link's export should not be cached by anything in between.
      "Cache-Control": "no-store",
    },
  });
}
