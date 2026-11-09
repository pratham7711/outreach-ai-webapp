import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Each campaign's lifetime views as they stood at the end of each of the last
 * TREND_DAYS days, summed over its live posts, read off the per-post
 * snapshots. A post counts from its first reading on; before that it adds 0,
 * so a post added mid-window brings the views it had on arrival into that
 * day's gain. For a campaign's own posts, published during the campaign, that
 * is the views they earned.
 */
export const TREND_DAYS = 14;

export type CampaignViewsTrend = {
  /** Oldest first, TREND_DAYS + 1 readings: the day before the window, then each day to today. */
  series: number[];
  /** Views gained over the last 7 days. */
  last7: number;
  /** Views gained over the 7 days before those. */
  prev7: number;
};

type Row = { campaignId: string; d: number; views: number };

export async function campaignViewsTrends(campaignIds: string[]): Promise<Map<string, CampaignViewsTrend>> {
  const out = new Map<string, CampaignViewsTrend>();
  if (campaignIds.length === 0) return out;
  /* One index seek per live post per day on (postId, recordedAt): for a page of
     25 campaigns that is posts x 15, never a scan of the snapshot table. */
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT p."campaignId" AS "campaignId", days.d::int AS d, COALESCE(SUM(s."viewsCount"), 0)::float8 AS views
    FROM "Post" p
    CROSS JOIN generate_series(0, ${TREND_DAYS}) AS days(d)
    LEFT JOIN LATERAL (
      SELECT "viewsCount" FROM "PostMetricSnapshot"
      WHERE "postId" = p.id
        AND "recordedAt" < date_trunc('day', now()) + interval '1 day' - days.d * interval '1 day'
      ORDER BY "recordedAt" DESC
      LIMIT 1
    ) s ON true
    WHERE p."campaignId" IN (${Prisma.join(campaignIds)}) AND p."removedAt" IS NULL
    GROUP BY p."campaignId", days.d
  `);
  const byCampaign = new Map<string, number[]>();
  for (const r of rows) {
    const series = byCampaign.get(r.campaignId) ?? new Array<number>(TREND_DAYS + 1).fill(0);
    series[TREND_DAYS - r.d] = r.views;
    byCampaign.set(r.campaignId, series);
  }
  for (const [id, series] of byCampaign) {
    const end = series[TREND_DAYS];
    const mid = series[TREND_DAYS - 7];
    const start = series[0];
    if (end <= 0) continue;
    out.set(id, { series, last7: Math.max(0, end - mid), prev7: Math.max(0, mid - start) });
  }
  return out;
}
