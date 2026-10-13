import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import { refreshTikTokCover } from "@/lib/platforms/fetchPostMetrics";
import { readInstagramPostPage } from "@/lib/platforms/instagramPostPage";
import {
  THUMB_RETRY_MS,
  isCopyableThumbnailUrl,
  isMissingThumbnailTable,
  recordThumbnailFailure,
  storeThumbnailFromUrl,
} from "@/lib/posts/thumbnailStore";

/**
 * The one-off pass that copies the covers the sync never saw.
 *
 * The sync keeps a copy of every cover it reads from now on
 * (lib/posts/thumbnailStore#capturePostThumbnail). This is for the posts read
 * before that, and for the campaigns nobody reads any more -- the ones whose
 * cards are already blank. Built to be run by hand through
 * /api/admin/backfill-post-thumbnails, in batches, until `remaining` is zero.
 * There is no cron: once the backlog is gone the sync keeps up on its own.
 *
 * Order, most visible first:
 *   1. posts on a campaign with a live client share link -- what a brand sees;
 *   2. every other post whose stored link still answers, soonest to expire
 *      first, because each of those costs one CDN download and no platform
 *      call, and stops being free the moment its signature runs out;
 *   3. posts whose link has expired, or that never had one, re-read through the
 *      public, logged-out routes the code already has: TikTok's oEmbed
 *      (refreshTikTokCover) and Instagram's own post page
 *      (lib/platforms/instagramPostPage). Never a logged-in Instagram read,
 *      never another region's sandbox.
 *
 * Left out on purpose, and counted so the dry run says how many:
 *   - YouTube, whose covers sit at a fixed address that never expires;
 *   - CreatorCore's imported pictures (Bubble CDN, or stored protocol-relative),
 *     which are CreatorCore's own copies and do not expire either;
 *   - links on any other host, which are not a platform's signed cover.
 *
 * Idempotent: a post with a copy is never selected again, and one that failed
 * is left alone for THUMB_RETRY_MS (unless asked to retry), so re-running a
 * batch makes progress instead of repeating the same failures.
 */

/** A signature this close to expiry is treated as already expired, as in the avatar store. */
const EXPIRY_MARGIN_S = 10 * 60;

export type BackfillLink = "live" | "expired" | "missing" | "creatorcore" | "other";

export type BackfillCounts = {
  /** Every TikTok and Instagram post in scope, copied or not. */
  posts: number;
  alreadyStored: number;
  /** Failed within the retry window; the next run after it tries them again. */
  recentlyFailed: number;
  creatorCoreHosted: number;
  otherHost: number;
  /** Still to copy, by what it will cost. */
  todo: {
    sharedLive: number;
    sharedRefetch: number;
    live: number;
    expired: number;
    missing: number;
  };
};

export type BackfillResult = {
  ok: true;
  dryRun: boolean;
  /** False while the DDL has not been applied: nothing was read or written. */
  tableReady: boolean;
  before: BackfillCounts | null;
  processed: { considered: number; stored: number; failed: number; skipped: number; bytes: number };
  failures: Record<string, number>;
  /** Still to copy after this run, by the same rules: run again while > 0. */
  remaining: number | null;
};

export type BackfillOptions = {
  dryRun?: boolean;
  /** Posts worked on this call. */
  limit?: number;
  /** One campaign only. */
  campaignId?: string | null;
  /** False copies only links that still answer, with no platform calls at all. */
  refetch?: boolean;
  /** Include posts that failed inside the retry window. */
  retryFailed?: boolean;
  /** Stop starting new posts after this long; the rest are counted as skipped. */
  deadlineMs?: number;
  concurrency?: number;
  nowMs?: number;
  /* The public re-reads, injectable so a test does not reach a platform. */
  readTikTokCover?: (postUrl: string) => Promise<string | null>;
  readInstagramCover?: (postUrl: string) => Promise<{ url: string | null; failure?: string }>;
};

/* The platform's own signed-cover hosts, in Postgres's regex dialect. The same
   rule as isCopyableThumbnailUrl, which still checks every link before it is
   fetched, so a disagreement here costs a wasted selection, never a bad copy. */
const SQL_LINK = `
  CASE
    WHEN b."thumbnailUrl" IS NULL OR b."thumbnailUrl" = '' THEN 'missing'
    WHEN b."thumbnailUrl" LIKE '//%' OR b."thumbnailUrl" ~* '^https?://[^/?#]*\\.cdn\\.bubble\\.io(/|$)' THEN 'creatorcore'
    WHEN NOT (
      (b.platform = 'TIKTOK' AND b."thumbnailUrl" ~* '^https://[^/?#]*\\.tiktokcdn(-us|-eu)?\\.com/')
      OR (b.platform = 'INSTAGRAM' AND b."thumbnailUrl" ~* '^https://[^/?#]*\\.(cdninstagram\\.com|fbcdn\\.net)/')
    ) THEN 'other'
    WHEN b.expires IS NOT NULL AND b.expires <= $2 THEN 'expired'
    ELSE 'live'
  END`;

/* x-expires is TikTok's unix seconds; oe is Meta's, in hex. */
const SQL_EXPIRES = `COALESCE(
    substring(p."thumbnailUrl" from '[?&]x-expires=([0-9]{1,12})')::bigint,
    ('x' || lpad(substring(p."thumbnailUrl" from '[?&]oe=([0-9A-Fa-f]{6,15})'), 16, '0'))::bit(64)::bigint
  )`;

/** $1 campaign (or null), $2 the expiry cutoff in unix seconds, $3 the retry cutoff. */
const SQL_CLASSIFIED = `
  WITH b AS (
    SELECT p.id, p.platform::text AS platform, p."postUrl", p."thumbnailUrl", c."orgId",
      EXISTS (
        SELECT 1 FROM "Report" r
        WHERE r."campaignId" = p."campaignId" AND r."isPublic" = true
          AND r.config->>'kind' = 'campaign-performance'
      ) AS shared,
      (t.data IS NOT NULL) AS stored,
      (t."failedAt" IS NOT NULL AND t."failedAt" >= $3) AS "recentlyFailed",
      ${SQL_EXPIRES} AS expires
    FROM "Post" p
    JOIN "Campaign" c ON c.id = p."campaignId" AND c."deletedAt" IS NULL
    LEFT JOIN "PostThumbnail" t ON t."postId" = p.id
    WHERE p.platform::text IN ('TIKTOK', 'INSTAGRAM')
      AND ($1::text IS NULL OR p."campaignId" = $1::text)
  )
  SELECT b.*, ${SQL_LINK} AS link FROM b`;

type CountRow = { shared: boolean; stored: boolean; recentlyFailed: boolean; link: BackfillLink; n: bigint | number };

type WorkRow = {
  id: string;
  platform: string;
  postUrl: string;
  thumbnailUrl: string | null;
  orgId: string;
  shared: boolean;
  link: BackfillLink;
};

function emptyCounts(): BackfillCounts {
  return {
    posts: 0,
    alreadyStored: 0,
    recentlyFailed: 0,
    creatorCoreHosted: 0,
    otherHost: 0,
    todo: { sharedLive: 0, sharedRefetch: 0, live: 0, expired: 0, missing: 0 },
  };
}

/** Folds the grouped count rows into the dry run's report. Exported for the test. */
export function tallyBackfill(rows: CountRow[], retryFailed = false): BackfillCounts {
  const out = emptyCounts();
  for (const r of rows) {
    const n = Number(r.n);
    out.posts += n;
    if (r.stored) out.alreadyStored += n;
    else if (r.link === "creatorcore") out.creatorCoreHosted += n;
    else if (r.link === "other") out.otherHost += n;
    else if (r.recentlyFailed && !retryFailed) out.recentlyFailed += n;
    else if (r.shared) {
      if (r.link === "live") out.todo.sharedLive += n;
      else out.todo.sharedRefetch += n;
    } else out.todo[r.link] += n;
  }
  return out;
}

function todoTotal(c: BackfillCounts, refetch: boolean): number {
  const t = c.todo;
  return t.sharedLive + t.live + (refetch ? t.sharedRefetch + t.expired + t.missing : 0);
}

async function countAll(campaignId: string | null, cutoffS: number, retryBefore: Date, retryFailed: boolean) {
  const rows = await db.$queryRawUnsafe<CountRow[]>(
    `SELECT shared, stored, "recentlyFailed", link, count(*) AS n
       FROM (${SQL_CLASSIFIED}) x
      GROUP BY shared, stored, "recentlyFailed", link`,
    campaignId,
    cutoffS,
    retryBefore
  );
  return tallyBackfill(rows, retryFailed);
}

async function selectWork(
  campaignId: string | null,
  cutoffS: number,
  retryBefore: Date,
  opts: { refetch: boolean; retryFailed: boolean; limit: number }
): Promise<WorkRow[]> {
  const links = opts.refetch ? `('live', 'expired', 'missing')` : `('live')`;
  return db.$queryRawUnsafe<WorkRow[]>(
    `SELECT id, platform, "postUrl", "thumbnailUrl", "orgId", shared, link
       FROM (${SQL_CLASSIFIED}) x
      WHERE NOT stored
        AND link IN ${links}
        ${opts.retryFailed ? "" : `AND NOT "recentlyFailed"`}
      ORDER BY shared DESC, (link = 'live') DESC, expires ASC NULLS LAST, id
      LIMIT $4`,
    campaignId,
    cutoffS,
    retryBefore,
    opts.limit
  );
}

async function defaultInstagramCover(postUrl: string): Promise<{ url: string | null; failure?: string }> {
  const page = await readInstagramPostPage(postUrl, undefined, { askElsewhere: false });
  if (page.kind === "not-public") return { url: null, failure: "post not public" };
  return { url: page.thumbnailUrl, ...(page.thumbnailUrl ? {} : { failure: "page carried no cover" }) };
}

/**
 * One batch. A dry run reads two counts and touches nothing else: no
 * download, no platform call, no write.
 */
export async function backfillPostThumbnails(options: BackfillOptions = {}): Promise<BackfillResult> {
  const log = createLogger({ context: { job: "backfill-post-thumbnails" } });
  const nowMs = options.nowMs ?? Date.now();
  const cutoffS = Math.floor(nowMs / 1000) + EXPIRY_MARGIN_S;
  const retryBefore = new Date(nowMs - THUMB_RETRY_MS);
  const campaignId = options.campaignId || null;
  const refetch = options.refetch !== false;
  const retryFailed = options.retryFailed === true;
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50) || 50, 1), 500);
  const concurrency = Math.min(Math.max(Math.floor(options.concurrency ?? 3) || 3, 1), 8);
  const deadline = Date.now() + (options.deadlineMs ?? 45_000);
  const readTikTokCover = options.readTikTokCover ?? refreshTikTokCover;
  const readInstagramCover = options.readInstagramCover ?? defaultInstagramCover;

  const processed = { considered: 0, stored: 0, failed: 0, skipped: 0, bytes: 0 };
  const failures: Record<string, number> = {};
  const fail = (reason: string) => {
    processed.failed++;
    failures[reason] = (failures[reason] ?? 0) + 1;
  };

  let before: BackfillCounts;
  try {
    before = await countAll(campaignId, cutoffS, retryBefore, retryFailed);
  } catch (e) {
    if (isMissingThumbnailTable(e)) {
      return { ok: true, dryRun: options.dryRun === true, tableReady: false, before: null, processed, failures, remaining: null };
    }
    throw e;
  }
  if (options.dryRun) {
    return { ok: true, dryRun: true, tableReady: true, before, processed, failures, remaining: todoTotal(before, refetch) };
  }

  const work = await selectWork(campaignId, cutoffS, retryBefore, { refetch, retryFailed, limit });

  const one = async (row: WorkRow) => {
    processed.considered++;
    const post = { id: row.id, orgId: row.orgId };
    let lastFailure = "no cover";

    if (row.link === "live" && row.thumbnailUrl) {
      const r = await storeThumbnailFromUrl(post, row.thumbnailUrl, { timeoutMs: 10_000 });
      if (r.stored) {
        processed.stored++;
        processed.bytes += r.bytes;
        return;
      }
      lastFailure = `stored link: ${r.failure}`;
      /* A link that looked live and still refused falls through to a re-read,
         when re-reads are allowed; its failure is already on the row. */
      if (!refetch) return fail(lastFailure);
    }

    let fresh: string | null = null;
    try {
      if (row.platform === "TIKTOK") {
        fresh = await readTikTokCover(row.postUrl);
        if (!fresh) lastFailure = "oEmbed carried no cover";
      } else {
        const ig = await readInstagramCover(row.postUrl);
        fresh = ig.url;
        if (!fresh) lastFailure = ig.failure ?? "page carried no cover";
      }
    } catch (e) {
      lastFailure = `re-read threw: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }

    if (fresh && isCopyableThumbnailUrl(row.platform, fresh, nowMs)) {
      const r = await storeThumbnailFromUrl(post, fresh, { timeoutMs: 10_000 });
      if (r.stored) {
        processed.stored++;
        processed.bytes += r.bytes;
        return;
      }
      return fail(`fresh link: ${r.failure}`);
    }
    if (fresh) lastFailure = "re-read gave a link we do not copy";
    await recordThumbnailFailure(row.id, row.orgId, lastFailure);
    fail(lastFailure);
  };

  let next = 0;
  const worker = async () => {
    while (next < work.length && Date.now() <= deadline) {
      const row = work[next++];
      try {
        await one(row);
      } catch (e) {
        fail(`error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(work.length, 1)) }, worker));
  processed.skipped += work.length - next;

  const after = await countAll(campaignId, cutoffS, retryBefore, retryFailed);
  log.info("post thumbnail backfill batch", { ...processed, campaignId, refetch });
  return { ok: true, dryRun: false, tableReady: true, before, processed, failures, remaining: todoTotal(after, refetch) };
}
