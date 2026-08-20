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
export function mapCampaignStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s.includes("complet")) return "COMPLETE";
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("pend")) return "PENDING";
  if (s.includes("draft")) return "DRAFT";
  return "IN_PROGRESS";
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
    };
    const existingId = idmap[rec._id];
    if (existingId) {
      await db.campaign.update({ where: { id: existingId }, data }).catch(async () => {
        const c = await db.campaign.create({ data });
        idmap[rec._id] = c.id;
      });
      cUpdated++;
    } else {
      const byTitle = await db.campaign.findFirst({ where: { orgId: org.id, title: data.title } });
      if (byTitle) {
        await db.campaign.update({ where: { id: byTitle.id }, data });
        idmap[rec._id] = byTitle.id;
        cUpdated++;
      } else {
        const c = await db.campaign.create({ data });
        idmap[rec._id] = c.id;
        cCreated++;
      }
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
    };
    if (!data.postUrl) { pSkipped++; continue; }

    const existingId = idmap[rec._id];
    if (existingId) {
      await db.post.update({ where: { id: existingId }, data }).catch(() => {});
      pUpdated++;
    } else {
      const byUrl = await db.post.findFirst({ where: { campaignId, postUrl: data.postUrl } });
      if (byUrl) {
        await db.post.update({ where: { id: byUrl.id }, data });
        idmap[rec._id] = byUrl.id;
        pUpdated++;
      } else {
        const p = await db.post.create({ data });
        idmap[rec._id] = p.id;
        pCreated++;
      }
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
