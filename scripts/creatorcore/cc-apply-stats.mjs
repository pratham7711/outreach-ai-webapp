/**
 * Applies the fetched CreatorCore statistics to our Post rows.
 *
 *   node --env-file=.env scripts/creatorcore/cc-apply-stats.mjs           # dry run
 *   node --env-file=.env scripts/creatorcore/cc-apply-stats.mjs --apply   # write
 *
 * Reads statistic-post.jsonl (see cc-fetch-stats.mjs) and matches each record to
 * a Post by `ccPostId`, which is the CreatorCore `_id` we stored on import.
 *
 * Field mapping, confirmed against a record cross-checked with the reference UI:
 *   views         -> viewsCount
 *   likes         -> likesCount
 *   comments      -> commentsCount
 *   shareCount    -> sharesCount
 *   downloadCount -> downloadsCount
 *   saves         -> savesCount       (present on ~6% of rows; absent elsewhere)
 *   engagementRate-> engagementRate   (already a fraction: 0.1004 = 10.04%)
 *
 * Audited across 9,372 fetched records rather than the single post the mapping
 * was first cross-checked on:
 *
 *   - `saves` DOES exist. An earlier version of this script skipped savesCount
 *     claiming the record had no saves field; it was looking for `saveCount`.
 *     Non-null on 1,151 rows (TikTok 1055, Instagram 31, YouTube 65) and null
 *     elsewhere, which the provenance rule in lib/metricDisplay already handles.
 *   - `engagement` is their sum of likes + comments + shares + downloads PLUS
 *     saves where saves exists: 8,767 rows match the four-term sum, 804 match
 *     the five-term sum, and 0 match neither. Derived, so not stored.
 *   - `engagementRate` is exactly engagement/views in every row. Values above
 *     1.0 are real, not a unit mix-up -- a TikTok post with 2,440 views and
 *     6,043 likes genuinely rates 253%.
 *
 * lastSyncedAt is set to the stats row's Modified Date, not now(): that is when
 * the metrics were actually measured, it makes the "Last Synced" column
 * truthful, and it is what lib/metricDisplay reads to tell a real zero from an
 * unmeasured one.
 *
 * Idempotent -- re-running writes the same values. Dry run by default because
 * this touches 18k rows.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../lib/generated/prisma/client.js";

const APPLY = process.argv.includes("--apply");
const IN = path.join(import.meta.dirname, "out", "statistic-post.jsonl");

if (!existsSync(IN)) {
  console.error(`${IN} not found -- run cc-fetch-stats.mjs first.`);
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const stats = [];
const stream = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
for await (const line of stream) {
  if (!line.trim()) continue;
  let r;
  try {
    r = JSON.parse(line);
  } catch {
    continue;
  }
  if (!r.__postId) continue;
  stats.push({
    ccPostId: r.__postId,
    viewsCount: num(r.views),
    likesCount: num(r.likes),
    commentsCount: num(r.comments),
    sharesCount: num(r.shareCount),
    downloadsCount: num(r.downloadCount),
    savesCount: num(r.saves),
    engagementRate: num(r.engagementRate),
    measuredAt: r["Modified Date"] ? new Date(r["Modified Date"]) : null,
  });
}

console.log(`${stats.length} stats records read`);

// One query rather than 18k: which of these posts do we actually hold?
const known = await db.post.findMany({
  where: { ccPostId: { in: stats.map((s) => s.ccPostId) } },
  select: { id: true, ccPostId: true, likesCount: true, lastSyncedAt: true },
});
const byCcId = new Map(known.map((p) => [p.ccPostId, p]));
console.log(`${byCcId.size} of them match a Post we hold`);

let wouldChange = 0;
let unmatched = 0;
let engagementGained = 0;

const updates = [];
for (const s of stats) {
  const post = byCcId.get(s.ccPostId);
  if (!post) {
    unmatched += 1;
    continue;
  }
  const data = {};
  for (const key of [
    "viewsCount",
    "likesCount",
    "commentsCount",
    "sharesCount",
    "downloadsCount",
    "savesCount",
    "engagementRate",
  ]) {
    if (s[key] !== null) data[key] = s[key];
  }
  if (Object.keys(data).length === 0) continue;
  if (s.measuredAt && !Number.isNaN(s.measuredAt.getTime())) {
    data.lastSyncedAt = s.measuredAt;
  }
  // Posts that had no engagement and now will: the whole point of the exercise.
  if (!post.likesCount && (data.likesCount ?? 0) > 0) engagementGained += 1;
  wouldChange += 1;
  updates.push({ id: post.id, data });
}

console.log(
  `${wouldChange} posts to update · ${engagementGained} gaining engagement they did not have · ` +
    `${unmatched} stats rows with no matching Post`,
);

if (!APPLY) {
  console.log("\ndry run -- pass --apply to write");
  const sample = updates.slice(0, 3);
  for (const u of sample) console.log(`  ${u.id}  ${JSON.stringify(u.data)}`);
  await db.$disconnect();
  process.exit(0);
}

let done = 0;
const CHUNK = 200;
for (let i = 0; i < updates.length; i += CHUNK) {
  const chunk = updates.slice(i, i + CHUNK);
  await db.$transaction(
    chunk.map((u) => db.post.update({ where: { id: u.id }, data: u.data })),
  );
  done += chunk.length;
  if (done % 2000 < CHUNK || done === updates.length) {
    console.log(`  ${done}/${updates.length}`);
  }
}

console.log(`\napplied to ${done} posts`);
await db.$disconnect();
