// CreatorCore importer — loads the JSONL produced by cc-extract.mjs into our DB.
//
// Design goal ("don't miss any data point"): the ENTIRE raw CreatorCore record is
// stored verbatim in platformMetrics.__cc (posts) / typeConfig.__cc (campaigns).
// The mapped columns are a best-effort convenience layer on top; the raw is the
// source of truth and nothing is discarded.
//
// Idempotent: a local id map (out/_idmap.json) records CreatorCore _id -> our id,
// so re-running updates in place instead of duplicating. Delete _idmap.json to
// force a fresh match by natural key (campaign title / post url).
//
// Run against DEV first, then prod:
//   node --env-file=.env       scripts/creatorcore/cc-import.mjs
//   DATABASE_URL=<prod-url>    node scripts/creatorcore/cc-import.mjs
//
// Target org: set CC_IMPORT_ORG_ID, else it resolves admin@demo.com's org, else
// the first Organization. It prints which org it chose before writing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "../../lib/generated/prisma/index.js";
const { PrismaClient } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const IDMAP = path.join(OUT, "_idmap.json");

let db; // created in main() so tests can import the pure helpers without a DB

// ── helpers ────────────────────────────────────────────────────────────────
function readJsonl(name) {
  const f = path.join(OUT, `${name}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const idmap = fs.existsSync(IDMAP) ? JSON.parse(fs.readFileSync(IDMAP, "utf8")) : {};
const saveIdmap = () => fs.writeFileSync(IDMAP, JSON.stringify(idmap, null, 2));

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER", "FACEBOOK", "TWITCH", "THREADS", "PINTEREST", "SNAPCHAT", "LINKEDIN"];
export function mapPlatform(raw, url = "") {
  const s = String(raw || "").toUpperCase();
  for (const p of PLATFORMS) if (s.includes(p) || s.includes(p.slice(0, 4))) return p;
  const u = url.toLowerCase();
  if (u.includes("tiktok")) return "TIKTOK";
  if (u.includes("instagram")) return "INSTAGRAM";
  if (u.includes("youtu")) return "YOUTUBE";
  if (u.includes("twitter") || u.includes("x.com")) return "TWITTER";
  return "TIKTOK";
}
// CreatorCore stores campaign status as a reference to an org-activationstatus
// record, not a label — and that type 404s on the Data API. These IDs were mapped
// by driving the app's own status tabs and matching their counts against ours:
// Complete 497, Active 4, Canceled 5 (3+2), Pending 0 — totalling all 506.
const CC_CAMPAIGN_STATUS = {
  "1749228030762x636436422338022800": "COMPLETE",    // UI: "497 Complete Campaigns"
  "1749228030702x337686101696905500": "IN_PROGRESS", // UI: "4 Active Campaigns"
  "1749228031045x851842503930208900": "CANCELLED",   // UI: Canceled (3 of the 5)
  "1749228031102x507523978686096100": "CANCELLED",   // UI: Canceled (2 of the 5)
};
export function mapCampaignStatus(raw) {
  const id = String(raw || "");
  if (CC_CAMPAIGN_STATUS[id]) return CC_CAMPAIGN_STATUS[id];
  // Fall back to label matching in case CreatorCore ever returns a plain string.
  const s = id.toLowerCase();
  if (s.includes("complet")) return "COMPLETE";
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("pend")) return "PENDING";
  if (s.includes("draft")) return "DRAFT";
  return "IN_PROGRESS";
}

// CreatorCore post status is a fetch outcome, NOT an approval state:
// Success 15714 / Unavailable 2719 / Error 227 / absent 20. It maps to its own
// PostFetchState dimension; approval status is left at the app's default so an
// import never fabricates an approval decision a human never made.
export function mapFetchState(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "success") return "LIVE";
  if (s === "unavailable") return "UNAVAILABLE";
  if (s === "error") return "ERROR";
  return "UNKNOWN";
}
export function mapPostStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("approv")) return "APPROVED";
  if (s.includes("reject") || s.includes("declin")) return "REJECTED";
  return "PENDING_REVIEW";
}
export function mapCurrency(raw) {
  const s = String(raw || "").toUpperCase();
  return ["USD", "EUR", "GBP", "INR"].find((c) => s.includes(c)) || "USD";
}
export function toDate(...cands) {
  for (const c of cands) {
    if (!c) continue;
    const d = new Date(c);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
export function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    if (m) return parseFloat(m[0]);
  }
  return 0;
}
// Pull a stat by fuzzy key match from a raw record (handles unknown CC field names).
export function statFrom(rec, ...needles) {
  if (!rec || typeof rec !== "object") return 0;
  for (const k of Object.keys(rec)) {
    const lk = k.toLowerCase();
    if (needles.some((n) => lk.includes(n))) {
      const val = num(rec[k]);
      if (val) return val;
    }
  }
  return 0;
}
export function platformPostIdFrom(url, fallback) {
  if (url) {
    const m = String(url).match(/(?:video|reel|p|shorts|status)\/([A-Za-z0-9_-]+)/) || String(url).match(/\/([A-Za-z0-9_-]{5,})\/?$/);
    if (m) return m[1];
  }
  return fallback;
}

// ── CreatorCore mirror mappers (lossless: known scalars → columns, rest in raw) ─
export function bool(v) {
  if (typeof v === "boolean") return v;
  if (v === "yes" || v === "true" || v === 1) return true;
  if (v === "no" || v === "false" || v === 0) return false;
  return null;
}
// float-or-null (unlike num(), which returns 0 for absent values)
export function fnum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return null;
}

export function ccCampaignData(rec, orgId) {
  return {
    orgId, ccId: rec._id, raw: rec,
    ccNumericId: fnum(rec.id),
    fullId: rec.fullID ?? null,
    title: rec.title ?? null,
    status: rec.status ?? null,
    thumbnail: rec.thumbnail ?? null,
    urlPreview: rec.urlPreview ?? null,
    sudoSlug: rec["sudo-slug"] ?? null,
    satellite: rec.satellite ?? null,
    organization: rec.organization ?? null,
    currency: rec.currency ?? null,
    budget: fnum(rec.budget),
    creatorRateTotals: fnum(rec.creatorRateTotals),
    commissionTotal: fnum(rec.commissionTotal),
    profitTotal: fnum(rec.profitTotal),
    refreshInterval: fnum(rec.refreshInterval),
    archive: bool(rec.Archive),
    refreshActive: bool(rec.refreshActive),
    tempComplete: bool(rec.tempComplete),
    viewMigrateComplete: bool(rec.viewMigrateComplete),
    actionColumnAdded: bool(rec.actionColumnAdded),
    defaultDeliverableViewAdded: bool(rec.defaultDeliverableViewAdded),
    createdBy: rec["Created By"] ?? null,
    recentSnapshot: rec.recentSnapshot ?? null,
    nextSnapshotWorkflow: rec.nextSnapshotWorkflow ?? null,
    createdDate: toDate(rec["Created Date"]),
    modifiedDate: toDate(rec["Modified Date"]),
    postRefreshAnchor: toDate(rec.postRefreshAnchor),
    lastRefresh: toDate(rec.lastRefresh),
    posts: rec.posts ?? null,
    activations: rec.activations ?? null,
    creatorProfiles: rec.creatorProfiles ?? null,
    metatags: rec.metatags ?? null,
    modules: rec.modules ?? null,
    snapshots: rec.snapshots ?? null,
    activity: rec.activity ?? null,
    campaignManagers: rec["Campaign Managers"] ?? null,
    activationColumns: rec.activationColumns ?? null,
    views: rec.views ?? null,
    displayPlatforms: rec.displayPlatforms ?? null,
  };
}

export function ccPostData(rec, orgId) {
  return {
    orgId, ccId: rec._id, raw: rec,
    campaign: rec.campaign ?? null,
    organization: rec.organization ?? null,
    lastStatistics: rec.lastStatistics ?? null,
    latestViewsEngagement: fnum(rec["latestViews/Engagement"]),
    platform: rec.platform ?? null,
    platformText: rec.platformTEXT ?? null,
    postUrl: rec.postUrl ?? null,
    status: rec.status ?? null,
    thumbnail: rec.thumbnail ?? null,
    username: rec.username ?? null,
    authorProfilePic: rec.authorProfilePic ?? null,
    createdBy: rec["Created By"] ?? null,
    createdByUser: rec.createdByUser ?? null,
    isInstagramStory: bool(rec.isInstagramStory),
    autoAdd: bool(rec.autoAdd),
    heicConvert: bool(rec.heicConvert),
    postDate: toDate(rec.postDate),
    lastFresh: toDate(rec.lastFresh),
    createdDate: toDate(rec["Created Date"]),
    modifiedDate: toDate(rec["Modified Date"]),
  };
}

// Bulk-load raw records into a mirror table. Clean per-org reload (deleteMany then
// chunked createMany) — orders of magnitude faster than per-row upsert over a
// remote pooler, and idempotent: re-running replaces this org's mirror rows.
async function mirrorMany(records, table, mapFn, label, orgId) {
  await db[table].deleteMany({ where: { orgId } });
  if (!records.length) { console.log(`  mirror ${label}: 0 rows`); return 0; }
  let n = 0;
  const CHUNK = 500;
  for (let i = 0; i < records.length; i += CHUNK) {
    const data = records.slice(i, i + CHUNK).filter((r) => r?._id).map(mapFn);
    if (data.length) { await db[table].createMany({ data, skipDuplicates: true }); n += data.length; }
    process.stdout.write(`\r  mirror ${label}: ${n}/${records.length}   `);
  }
  process.stdout.write("\n");
  console.log(`  mirror ${label}: ${n} rows`);
  return n;
}

// ── resolve target org + a creator-of-record user ────────────────────────────
async function resolveOrg() {
  if (process.env.CC_IMPORT_ORG_ID) {
    const o = await db.organization.findUnique({ where: { id: process.env.CC_IMPORT_ORG_ID } });
    if (o) return o;
    throw new Error(`CC_IMPORT_ORG_ID ${process.env.CC_IMPORT_ORG_ID} not found`);
  }
  const admin = await db.user.findFirst({ where: { email: "admin@demo.com" }, select: { orgId: true } });
  if (admin?.orgId) return db.organization.findUnique({ where: { id: admin.orgId } });
  const first = await db.organization.findFirst();
  if (!first) throw new Error("No Organization in DB. Seed one first.");
  return first;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL not set. Run with:  node --env-file=.env scripts/creatorcore/cc-import.mjs");
    process.exit(1);
  }
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const org = await resolveOrg();
  const user = await db.user.findFirst({ where: { orgId: org.id }, select: { id: true } });
  if (!user) throw new Error(`Org ${org.id} has no users; Campaign.createdById requires one.`);
  console.log(`Target org: ${org.name} (${org.id})`);
  console.log(`Records will be attributed to user ${user.id}\n`);

  const campaigns = readJsonl("campaign");
  const posts = readJsonl("post");
  const stats = readJsonl("statistic-post");
  console.log(`Loaded: ${campaigns.length} campaigns, ${posts.length} posts, ${stats.length} statistic-post\n`);
  if (campaigns.length === 0 && posts.length === 0) {
    console.error("No JSONL found in scripts/creatorcore/out/. Run cc-extract.mjs first.");
    process.exit(1);
  }

  const statMap = new Map(stats.map((s) => [s._id, s]));

  // ── mirror pass: EVERY field of EVERY type lands in the DB, losslessly ────────
  const refreshQueue = readJsonl("campaign-postrefreshqueue");
  console.log("Mirroring full CreatorCore records (every attribute):");
  await mirrorMany(campaigns, "ccCampaign", (r) => ccCampaignData(r, org.id), "campaign", org.id);
  await mirrorMany(posts, "ccPost", (r) => ccPostData(r, org.id), "post", org.id);
  await mirrorMany(stats, "ccStatisticPost", (r) => ({ orgId: org.id, ccId: r._id, raw: r }), "statistic-post", org.id);
  await mirrorMany(refreshQueue, "ccRefreshQueue", (r) => ({ orgId: org.id, ccId: r._id, raw: r }), "refresh-queue", org.id);

  // Any other extracted type → generic CcRecord, so no type is ever dropped.
  const KNOWN = new Set(["campaign", "post", "statistic-post", "campaign-postrefreshqueue"]);
  const otherTypes = fs.existsSync(OUT)
    ? fs.readdirSync(OUT).filter((f) => f.endsWith(".jsonl")).map((f) => f.slice(0, -6)).filter((t) => !KNOWN.has(t))
    : [];
  for (const t of otherTypes) {
    const recs = readJsonl(t);
    let n = 0;
    for (const rec of recs) {
      if (!rec?._id) continue;
      const data = { orgId: org.id, ccType: t, ccId: rec._id, raw: rec };
      await db.ccRecord.upsert({ where: { ccType_ccId: { ccType: t, ccId: rec._id } }, create: data, update: data });
      n++;
    }
    console.log(`  mirror ${t} -> CcRecord: ${n} rows`);
  }
  console.log("");

  // ── campaigns ──────────────────────────────────────────────────────────────
  let cCreated = 0, cUpdated = 0;
  for (const rec of campaigns) {
    const data = {
      orgId: org.id,
      title: rec.title || "(untitled CreatorCore campaign)",
      status: mapCampaignStatus(rec.status),
      thumbnailUrl: rec.thumbnail || null,
      budget: typeof rec.budget === "number" ? rec.budget : null,
      currency: mapCurrency(rec.currency),
      createdById: user.id,
      typeConfig: { __cc: rec }, // full raw campaign preserved
      createdAt: toDate(rec["Created Date"]) || undefined,
      // ─── CreatorCore parity ───────────────────────────────────────────────
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
    };
    // Match on the source _id, never on title: CreatorCore has 9 duplicate
    // titles (e.g. "SEM TEMPO - HARDSTYLE" x3) and title-matching silently
    // collapsed 10 distinct campaigns into one another.
    const existing = await db.campaign.findUnique({ where: { ccCampaignId: rec._id } });
    if (existing) {
      await db.campaign.update({ where: { id: existing.id }, data });
      idmap[rec._id] = existing.id;
      cUpdated++;
    } else {
      const c = await db.campaign.create({ data });
      idmap[rec._id] = c.id;
      cCreated++;
    }
  }
  saveIdmap();
  console.log(`Campaigns: ${cCreated} created, ${cUpdated} updated`);

  // ── creators (derived from posts) ────────────────────────────────────────────
  const creatorCache = new Map(); // key `${platform}|${handle}` -> our creator id
  async function resolveCreator(handle, platform, avatar) {
    handle = (handle || "unknown").trim();
    const key = `${platform}|${handle.toLowerCase()}`;
    if (creatorCache.has(key)) return creatorCache.get(key);
    let cr = await db.creator.findFirst({ where: { orgId: org.id, handle, platform } });
    if (!cr) {
      cr = await db.creator.create({
        data: { orgId: org.id, name: handle, handle, platform, avatarUrl: avatar || null },
      });
    }
    creatorCache.set(key, cr.id);
    return cr.id;
  }

  // ── posts ────────────────────────────────────────────────────────────────────
  let pCreated = 0, pUpdated = 0, pSkipped = 0;
  for (const rec of posts) {
    const campaignId = idmap[rec.campaign];
    if (!campaignId) { pSkipped++; continue; } // post whose campaign wasn't imported
    const platform = mapPlatform(rec.platformTEXT || rec.platform, rec.postUrl);
    const creatorId = await resolveCreator(rec.username, platform, rec.authorProfilePic);
    const statRec = rec.lastStatistics ? statMap.get(rec.lastStatistics) : null;
    const le = rec["latestViews/Engagement"];

    const views = statFrom(statRec, "view") || num(typeof le === "object" ? le?.views ?? le?.view : le);
    const data = {
      campaignId,
      creatorId,
      platform,
      platformPostId: platformPostIdFrom(rec.postUrl, rec._id),
      postUrl: rec.postUrl || "",
      thumbnailUrl: rec.thumbnail || null,
      postedAt: toDate(rec.postDate, rec["Created Date"]) || new Date(),
      viewsCount: views,
      likesCount: statFrom(statRec, "like", "heart"),
      commentsCount: statFrom(statRec, "comment"),
      sharesCount: statFrom(statRec, "share"),
      savesCount: statFrom(statRec, "save", "bookmark"),
      reachCount: statFrom(statRec, "reach"),
      engagementRate: statFrom(statRec, "engagementrate", "engagement_rate") || num(typeof le === "object" ? le?.engagement : 0),
      status: mapPostStatus(rec.status),
      platformMetrics: { __cc: rec, __stat: statRec || null }, // full raw preserved
      // ─── CreatorCore parity ───────────────────────────────────────────────
      ccPostId: rec._id,
      fetchState: mapFetchState(rec.status),
      ccStatusRaw: rec.status ?? null,
      isInstagramStory: bool(rec.isInstagramStory) ?? false,
      authorProfilePic: rec.authorProfilePic ?? null,
      lastFreshAt: toDate(rec.lastFresh),
      autoAdded: bool(rec.autoAdd) ?? false,
    };
    if (!data.postUrl) { pSkipped++; continue; }

    // Match on the source _id, never on (campaign, postUrl): 24 such pairs are
    // duplicated in CreatorCore, which collapsed 31 distinct posts.
    const existing = await db.post.findUnique({ where: { ccPostId: rec._id } });
    if (existing) {
      await db.post.update({ where: { id: existing.id }, data });
      idmap[rec._id] = existing.id;
      pUpdated++;
    } else {
      const p = await db.post.create({ data });
      idmap[rec._id] = p.id;
      pCreated++;
    }
    if ((pCreated + pUpdated) % 250 === 0) { saveIdmap(); process.stdout.write(`\r  posts: +${pCreated} ~${pUpdated} (skip ${pSkipped})   `); }
  }
  saveIdmap();
  process.stdout.write("\n");
  console.log(`Posts: ${pCreated} created, ${pUpdated} updated, ${pSkipped} skipped (no mapped campaign / no url)`);
  console.log(`Creators touched: ${creatorCache.size}`);
  console.log(`\nDone. Raw CreatorCore records preserved in platformMetrics.__cc / typeConfig.__cc.`);
  await db.$disconnect();
}

// Only run the import when invoked directly (so tests can import the pure helpers).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (e) => {
    console.error("Import failed:", e);
    await db.$disconnect();
    process.exit(1);
  });
}
