import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";
import { rateLimit } from "@/lib/rateLimit";
import { getRequestIp } from "@/lib/request";
import { fieldMetricValue, unwrittenMetricValue } from "@/lib/metricDisplay";
import { UNKNOWN } from "@/lib/format";
import { asOfCell } from "@/lib/dataAge";
import { isPostRemoved } from "@/lib/postRemoval";
import { postMeasuredAt, postStatus } from "@/lib/posts/postStatus";
// The shared cell writer: quotes only where needed, and neutralises the cells a
// spreadsheet would run rather than read -- a creator display name is user text
// and this file is opened in Excel more often than anywhere else.
import { csvCell } from "@/lib/csv";

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
 *    names;
 *  - the same provenance rule, so a counter no post has measured comes out as
 *    "—" rather than a zero a brand would read as a measurement;
 *  - the same status rule: a post is flagged gone only on a link whose owner
 *    turned "Flag removed posts" on, and only where the page would flag it.
 *
 * Every row ends with when its figures were read and by what (plan A2/A6),
 * appended after the existing columns so a saved import keeps its positions.
 */

const SHARE_KIND = "campaign-performance";

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
      campaign: { select: { id: true, orgId: true, title: true, currency: true } },
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
      ...NOT_REMOVED,
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
      lastFreshAt: true,
      fetchState: true,
      platformMetrics: true,
      creator: { select: { name: true, handle: true } },
    },
    orderBy: { viewsCount: "desc" },
  });

  /* Post URL travels with the creator columns, not with the metrics.
     redactForShare nulls postUrl on a hidden-creator link for the reason in its
     comment — a TikTok or Instagram URL carries /@handle/ in its path, so the
     column re-identifies every creator the link was set to hide, and one click
     lands on their profile. The CSV emitted it unconditionally, which made the
     export the way around the switch the page honours. */
  const header: string[] = [
    ...(visibility.showCreators ? ["Creator", "Handle"] : []),
    "Platform",
    "Posted",
    ...(visibility.showCreators ? ["Post URL"] : []),
    "Views",
    "Likes",
    "Comments",
    "Shares",
    "Saves",
    "Downloads",
    "Last synced",
    "As of",
    "Source",
    ...(visibility.markRemovedPosts ? ["Post status"] : []),
  ];

  /* The page's rule, cell for cell: a removed post carries the resolver's
     wording, a live one says so, and anything else -- a read that failed on
     our side -- is a claim the page does not make either. */
  const statusCell = (p: (typeof posts)[number]): string => {
    const status = postStatus(p);
    if (isPostRemoved(p)) return status.label;
    return status.kind === "live" ? status.label : UNKNOWN;
  };

  const rows: (string | number | null)[][] = [
    header,
    ...posts.map((p) => [
      ...(visibility.showCreators ? [p.creator.name, p.creator.handle ? `@${p.creator.handle.replace(/^@/, "")}` : ""] : []),
      p.platform,
      p.postedAt ? p.postedAt.toISOString().slice(0, 10) : "",
      ...(visibility.showCreators ? [p.postUrl] : []),
      fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") ?? UNKNOWN,
      fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes") ?? UNKNOWN,
      fieldMetricValue(p.commentsCount, p.lastSyncedAt, p.platformMetrics, "comments") ?? UNKNOWN,
      // With the platform: YouTube publishes no share count, nor Instagram
      // outside the creator's own insights, so their 0 is unknown here too.
      fieldMetricValue(p.sharesCount, p.lastSyncedAt, p.platformMetrics, "shares", p.platform) ?? UNKNOWN,
      // Nothing here writes these two, so a sync's timestamp does not vouch for
      // their zeroes the way it does for the columns above.
      unwrittenMetricValue(p.savesCount) ?? UNKNOWN,
      unwrittenMetricValue(p.downloadsCount) ?? UNKNOWN,
      p.lastSyncedAt ? p.lastSyncedAt.toISOString() : "",
      asOfCell(postMeasuredAt(p).at),
      postMeasuredAt(p).source,
      ...(visibility.markRemovedPosts ? [statusCell(p)] : []),
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
