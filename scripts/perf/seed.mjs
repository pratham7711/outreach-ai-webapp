/**
 * Synthetic production-scale volume for the page benchmark (scripts/perf/bench.mjs).
 *
 *   PERF_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/outreach_e2e \
 *     node scripts/perf/seed.mjs
 *
 * Adds, to the e2e seed's demo org: 1,700 creators (400 tracked, a week of
 * snapshots each), 480 campaigns, one campaign of 800 posts across 120
 * creators (`perf-big`), and a 300-creator list (`perf-list`). Every row is
 * invented -- `Perf Creator <n>` / `perf_creator_<n>` -- and every id starts
 * `perf-`, so `delete ... where id like 'perf-%'` takes it all back out.
 *
 * Refuses any host but localhost. It is meant for a throwaway Postgres
 * (docker run postgres:16, then `prisma db push` and `SEED_ALLOW=1 prisma db
 * seed`), never a Neon branch.
 */
import pg from "pg";

const url = process.env.PERF_DATABASE_URL;
if (!url) {
  console.error("set PERF_DATABASE_URL to a local throwaway database");
  process.exit(2);
}
const host = new URL(url).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`refusing: ${host} is not localhost`);
  process.exit(2);
}

const c = new pg.Client({ connectionString: url });
await c.connect();
const q = (s, p) => c.query(s, p).then((r) => r.rows);
const ORG = "cmnbxsoos00006vfd7jhdvusb";
const [admin] = await q(`select id from "User" where "orgId"=$1 and email='admin@demo.com'`, [ORG]);
if (!admin) {
  console.error("no admin@demo.com in the demo org: run the e2e seed first");
  process.exit(2);
}
const day = 864e5;
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const plats = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

async function bulk(table, cols, rows, casts = {}) {
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    const params = [];
    const tuples = chunk.map(
      (r) => "(" + r.map((v, j) => (params.push(v), "$" + params.length + (casts[cols[j]] ?? ""))).join(",") + ")",
    );
    await q(
      `insert into "${table}"(${cols.map((x) => `"${x}"`).join(",")}) values ${tuples.join(",")} on conflict do nothing`,
      params,
    );
  }
}

const NC = 1700;
const NCAMP = 480;
const NPOST = 800;

await bulk(
  "Creator",
  ["id", "orgId", "name", "handle", "platform", "followersCount", "trackedSince", "updatedAt"],
  Array.from({ length: NC }, (_, i) => [
    `perf-cr-${i}`, ORG, `Perf Creator ${i}`, `perf_creator_${i}`, plats[i % 3],
    1000 + ((i * 7919) % 2_000_000), i < 400 ? iso(now - 20 * day) : null, iso(now),
  ]),
  { platform: '::"Platform"' },
);

const snaps = [];
for (let i = 0; i < 400; i++) {
  for (let d = 6; d >= 0; d--) {
    snaps.push([
      `perf-cts-${i}-${d}`, `perf-cr-${i}`, 1000 + ((i * 7919) % 2_000_000) - d * 300, 100 + d,
      20000 + ((i * 31 + d) % 9000), (i % 7) * 50 - 120, (i % 10) / 2, iso(now - d * day - 3600e3),
    ]);
  }
}
await bulk(
  "CreatorTrackerSnapshot",
  ["id", "creatorId", "followersCount", "postsCount", "avgViews", "deltaFollowers", "velocityScore", "recordedAt"],
  snaps,
);

const statuses = ["PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"];
const campaignCols = ["id", "orgId", "title", "createdById", "status", "updatedAt", "createdAt"];
await bulk(
  "Campaign",
  campaignCols,
  Array.from({ length: NCAMP }, (_, i) => [
    `perf-camp-${i}`, ORG, `Perf Campaign ${i} (${["Sep", "Aug", "Oct"][i % 3]})`, admin.id, statuses[i % 4],
    iso(now - i * 3600e3), iso(now - i * 3600e3),
  ]),
  { status: '::"CampaignStatus"' },
);
await bulk(
  "Campaign",
  campaignCols,
  [["perf-big", ORG, "Perf Big Campaign (800 posts)", admin.id, "IN_PROGRESS", iso(now), iso(now)]],
  { status: '::"CampaignStatus"' },
);
await bulk(
  "Activation",
  ["id", "campaignId", "creatorId", "updatedAt"],
  Array.from({ length: 120 }, (_, i) => [`perf-act-${i}`, "perf-big", `perf-cr-${i}`, iso(now)]),
);

const posts = [];
const postSnaps = [];
for (let i = 0; i < NPOST; i++) {
  const p = plats[i % 3];
  const views = (i * 104729) % 2_000_000;
  const url =
    p === "TIKTOK"
      ? `https://www.tiktok.com/@perf_creator_${i % 120}/video/76${String(1e15 + i)}`
      : p === "INSTAGRAM"
        ? `https://www.instagram.com/reel/PERF${i}xyz/`
        : `https://www.youtube.com/shorts/perf${i}abcd`;
  posts.push([
    `perf-post-${i}`, "perf-big", `perf-cr-${i % 120}`, p, `perf${i}`, url, iso(now - (i % 60) * day), views,
    Math.round(views * 0.08), Math.round(views * 0.004), Math.round(views * 0.002), iso(now - (i % 5) * 3600e3),
    "LIVE", iso(now),
  ]);
  for (let d = 2; d >= 0; d--) {
    postSnaps.push([
      `perf-pms-${i}-${d}`, `perf-post-${i}`, Math.round(views * (1 - d * 0.15)), Math.round(views * 0.08 * (1 - d * 0.15)),
      Math.round(views * 0.004), Math.round(views * 0.002), iso(now - d * day),
    ]);
  }
}
await bulk(
  "Post",
  ["id", "campaignId", "creatorId", "platform", "platformPostId", "postUrl", "postedAt", "viewsCount", "likesCount",
    "commentsCount", "sharesCount", "lastSyncedAt", "fetchState", "updatedAt"],
  posts,
  { platform: '::"Platform"', fetchState: '::"PostFetchState"' },
);
await bulk(
  "PostMetricSnapshot",
  ["id", "postId", "viewsCount", "likesCount", "commentsCount", "sharesCount", "recordedAt"],
  postSnaps,
);

await bulk("CreatorList", ["id", "orgId", "name", "updatedAt"], [["perf-list", ORG, "Perf List (300 creators)", iso(now)]]);
await bulk(
  "CreatorListItem",
  ["id", "listId", "creatorId"],
  Array.from({ length: 300 }, (_, i) => [`perf-li-${i}`, "perf-list", `perf-cr-${i}`]),
);

const [counts] = await q(`select
  (select count(*) from "Campaign" where "deletedAt" is null)::int campaigns,
  (select count(*) from "Post")::int posts,
  (select count(*) from "Creator")::int creators,
  (select count(*) from "Post" where "campaignId"='perf-big')::int big_posts`);
console.log(JSON.stringify(counts));
await c.end();
