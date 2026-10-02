import { db } from "@/lib/db";

/**
 * One video, however many campaigns it was delivered against.
 *
 * A creator's video can legitimately sit in two campaigns (two briefs, one
 * post), and each campaign counts its own views -- that is the add-post
 * route's rule and it stays. But an ORG total that adds both rows counts the
 * same views twice: on production 305 extra copies carried 61.3M of 1,851M
 * views, 3.3% of the headline, 59.0M of it on TikTok (measured 2026-10-03).
 *
 * The identity is the platform's video id read out of the URL, not
 * platformPostId: CreatorCore's importer stored its own record ids there, so
 * two copies of one TikTok video carry two different "post ids". A URL no
 * pattern claims is compared without its query string.
 */
export function postVideoKeySql(alias: string): string {
  const url = `${alias}."postUrl"`;
  return `COALESCE(
    CASE ${alias}.platform::text
      WHEN 'TIKTOK' THEN substring(${url} from '/(?:video|photo)/([0-9]+)')
      WHEN 'INSTAGRAM' THEN substring(${url} from '/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)')
      WHEN 'YOUTUBE' THEN substring(${url} from '(?:youtu\\.be/|[?&]v=|/shorts/|/live/|/embed/)([A-Za-z0-9_-]{11})')
    END,
    split_part(${url}, '?', 1)
  )`;
}

/**
 * The org's posts that repeat a video another of its posts already counts.
 *
 * Org-wide totals leave these out (`id: { notIn }`), so each video is counted
 * once; a campaign's own figures never use this. The copy kept is the one
 * with the most views -- view counts only grow, so that is the freshest read.
 */
export async function duplicatePostIds(orgId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM (
       SELECT p.id,
              row_number() OVER (
                PARTITION BY p.platform, ${postVideoKeySql("p")}
                ORDER BY p."viewsCount" DESC, p."lastSyncedAt" DESC NULLS LAST, p.id
              ) AS copy
         FROM "Post" p
         JOIN "Campaign" c ON c.id = p."campaignId"
        WHERE c."orgId" = $1 AND c."deletedAt" IS NULL
     ) ranked
     WHERE copy > 1`,
    orgId,
  );
  return rows.map((r) => r.id);
}

/** A Prisma post filter that drops the repeats, or nothing when there are none. */
export function excludingDuplicates(ids: readonly string[]): { id?: { notIn: string[] } } {
  return ids.length > 0 ? { id: { notIn: [...ids] } } : {};
}
