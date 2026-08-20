// Pushes the extracted CreatorCore data to an environment we cannot reach
// directly, by driving /api/admin/cc-sync on that environment.
//
//   CC_SYNC_TOKEN=… node scripts/creatorcore/cc-push-prod.mjs [--base https://…] [--dry]
//
// The mapping is done here, locally, with the very same mappers cc-import.mjs
// uses — the endpoint is a dumb bulk loader, so there is only one copy of the
// mapping logic and cc-import.test.mjs still covers it.
//
// Resumable: it asks the target which source ids it already holds and sends only
// the remainder, so an interrupted run can simply be re-run.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  ccCampaignData,
  ccPostData,
  mapPlatform,
  mapCampaignStatus,
  mapPostStatus,
  mapFetchState,
  mapCurrency,
  toDate,
  num,
  bool,
  fnum,
  statFrom,
  platformPostIdFrom,
} from "./cc-import.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://campaign.madeboring.com").replace(/\/$/, "");
const DRY = args.includes("--dry");
const TOKEN = process.env.CC_SYNC_TOKEN;
if (!TOKEN) {
  console.error("CC_SYNC_TOKEN not set");
  process.exit(1);
}

const readJsonl = (name) => {
  const f = path.join(OUT, `${name}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

async function call(payload, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/admin/cc-sync`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`); }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${json.error ?? text.slice(0, 300)}`);
      return json;
    } catch (e) {
      if (attempt >= tries) throw e;
      const wait = Math.min(30_000, 1500 * 2 ** (attempt - 1));
      process.stdout.write(`\n  retry ${attempt}/${tries - 1} in ${wait}ms — ${e.message}\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function loadTable(table, rows, chunk) {
  let sent = 0, inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (!DRY) {
      const r = await call({ action: "load", table, rows: slice });
      inserted += r.inserted;
    }
    sent += slice.length;
    process.stdout.write(`\r  ${table}: ${sent}/${rows.length} sent, ${inserted} inserted   `);
  }
  process.stdout.write("\n");
  return inserted;
}

const campaigns = readJsonl("campaign");
const posts = readJsonl("post");
const refreshQueue = readJsonl("campaign-postrefreshqueue");
const stats = readJsonl("statistic-post");
const statMap = new Map(stats.map((s) => [s._id, s]));

console.log(`Target : ${BASE}`);
console.log(`Source : ${campaigns.length} campaigns, ${posts.length} posts, ${refreshQueue.length} refresh-queue, ${stats.length} statistic-post`);
if (DRY) console.log("DRY RUN — nothing will be written\n");
if (!campaigns.length && !posts.length) {
  console.error("No JSONL in scripts/creatorcore/out/ — run cc-extract.mjs first.");
  process.exit(1);
}

// ── 0. schema ────────────────────────────────────────────────────────────────
if (!DRY) {
  const m = await call({ action: "migrate" });
  console.log(`\nSchema: ${m.statements} statements applied (idempotent)`);
}

// ── 1. mirrors: the untouched source records ─────────────────────────────────
console.log("\nMirror tables (verbatim source):");
for (const [table, records, mapFn] of [
  ["ccCampaign", campaigns, (r) => ccCampaignData(r, null)],
  ["ccPost", posts, (r) => ccPostData(r, null)],
  ["ccRefreshQueue", refreshQueue, (r) => ({ ccId: r._id, raw: r })],
  ["ccStatisticPost", stats, (r) => ({ ccId: r._id, raw: r })],
]) {
  const have = DRY ? new Set() : new Set((await call({ action: "have", table })).keys);
  const todo = records.filter((r) => r?._id && !have.has(r._id));
  if (have.size) console.log(`  ${table}: ${have.size} already present`);
  if (!todo.length) { console.log(`  ${table}: nothing to send`); continue; }
  await loadTable(table, todo.map(mapFn), table === "ccPost" ? 400 : 500);
}

// ── 2. domain campaigns ──────────────────────────────────────────────────────
console.log("\nDomain rows:");
const existingCampaigns = DRY ? [] : (await call({ action: "have", table: "campaign" })).rows;
const campaignIdByCc = new Map(existingCampaigns.map((r) => [r.ccCampaignId, r.id]));
const newCampaigns = [];
for (const rec of campaigns) {
  if (campaignIdByCc.has(rec._id)) continue;
  const id = randomUUID();
  campaignIdByCc.set(rec._id, id);
  newCampaigns.push({
    id,
    title: rec.title || "(untitled CreatorCore campaign)",
    status: mapCampaignStatus(rec.status),
    thumbnailUrl: rec.thumbnail || null,
    budget: typeof rec.budget === "number" ? rec.budget : null,
    currency: mapCurrency(rec.currency),
    typeConfig: { __cc: rec },
    createdAt: toDate(rec["Created Date"]) ?? undefined,
    ccCampaignId: rec._id,
    ccStatusId: rec.status ?? null,
    ccFullId: rec.fullID ?? null,
    ccSlug: rec["sudo-slug"] ?? null,
    archived: bool(rec.Archive) ?? false,
    refreshActive: bool(rec.refreshActive),
    refreshInterval: fnum(rec.refreshInterval),
    lastRefreshAt: toDate(rec.lastRefresh),
    postRefreshAnchor: toDate(rec.postRefreshAnchor),
    creatorRateTotals: fnum(rec.creatorRateTotals),
    commissionTotal: fnum(rec.commissionTotal),
    profitTotal: fnum(rec.profitTotal),
  });
}
if (existingCampaigns.length) console.log(`  campaign: ${existingCampaigns.length} already present`);
if (newCampaigns.length) await loadTable("campaign", newCampaigns, 200);
else console.log("  campaign: nothing to send");

// ── 3. creators, derived from post authors ───────────────────────────────────
const existingCreators = DRY ? [] : (await call({ action: "have", table: "creator" })).rows;
const creatorIdByKey = new Map(existingCreators.map((r) => [`${r.platform}|${(r.handle || "").toLowerCase()}`, r.id]));
const newCreators = [];
for (const rec of posts) {
  const platform = mapPlatform(rec.platformTEXT || rec.platform, rec.postUrl);
  const handle = (rec.username || "unknown").trim();
  const key = `${platform}|${handle.toLowerCase()}`;
  if (creatorIdByKey.has(key)) continue;
  const id = randomUUID();
  creatorIdByKey.set(key, id);
  newCreators.push({ id, name: handle, handle, platform, avatarUrl: rec.authorProfilePic || null });
}
if (existingCreators.length) console.log(`  creator: ${existingCreators.length} already present`);
if (newCreators.length) await loadTable("creator", newCreators, 500);
else console.log("  creator: nothing to send");

// ── 4. domain posts ──────────────────────────────────────────────────────────
const havePosts = DRY ? new Set() : new Set((await call({ action: "have", table: "post" })).keys);
const newPosts = [];
let skipped = 0;
for (const rec of posts) {
  if (havePosts.has(rec._id)) continue;
  const campaignId = campaignIdByCc.get(rec.campaign);
  if (!campaignId || !rec.postUrl) { skipped++; continue; }
  const platform = mapPlatform(rec.platformTEXT || rec.platform, rec.postUrl);
  const creatorId = creatorIdByKey.get(`${platform}|${(rec.username || "unknown").trim().toLowerCase()}`);
  const statRec = rec.lastStatistics ? statMap.get(rec.lastStatistics) ?? null : null;
  const le = rec["latestViews/Engagement"];
  newPosts.push({
    id: randomUUID(),
    campaignId,
    creatorId,
    platform,
    platformPostId: platformPostIdFrom(rec.postUrl, rec._id),
    postUrl: rec.postUrl,
    thumbnailUrl: rec.thumbnail || null,
    postedAt: toDate(rec.postDate, rec["Created Date"]) ?? new Date(),
    viewsCount: statFrom(statRec, "view") || num(typeof le === "object" ? le?.views ?? le?.view : le),
    likesCount: statFrom(statRec, "like", "heart"),
    commentsCount: statFrom(statRec, "comment"),
    sharesCount: statFrom(statRec, "share"),
    savesCount: statFrom(statRec, "save", "bookmark"),
    reachCount: statFrom(statRec, "reach"),
    engagementRate:
      statFrom(statRec, "engagementrate", "engagement_rate") || num(typeof le === "object" ? le?.engagement : 0),
    status: mapPostStatus(rec.status),
    platformMetrics: { __cc: rec, __stat: statRec },
    ccPostId: rec._id,
    fetchState: mapFetchState(rec.status),
    ccStatusRaw: rec.status ?? null,
    isInstagramStory: bool(rec.isInstagramStory) ?? false,
    authorProfilePic: rec.authorProfilePic ?? null,
    lastFreshAt: toDate(rec.lastFresh),
    autoAdded: bool(rec.autoAdd) ?? false,
  });
}
if (havePosts.size) console.log(`  post: ${havePosts.size} already present`);
if (skipped) console.log(`  post: ${skipped} skipped (campaign not imported / no url)`);
if (newPosts.length) await loadTable("post", newPosts, 300);
else console.log("  post: nothing to send");

// ── 5. what the target holds now ─────────────────────────────────────────────
if (!DRY) {
  const c = await call({ action: "counts" });
  console.log("\nTarget now holds:");
  console.log(JSON.stringify(c, null, 2));
}
