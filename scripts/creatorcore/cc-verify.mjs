// Verifies an import by reconciling the database against the extracted JSONL —
// no hardcoded expectations, so it works for dev and prod alike.
//
//   node --env-file=.env scripts/creatorcore/cc-verify.mjs
//   DATABASE_URL='postgres://…prod…' node scripts/creatorcore/cc-verify.mjs
//
// Exits non-zero if anything fails to reconcile, so it can gate a deploy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "../../lib/generated/prisma/index.js";
const { PrismaClient } = pkg;

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
const read = (n) => {
  const f = path.join(OUT, `${n}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const fails = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) fails.push(`${label}: expected ${expected}, got ${actual}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(42)} ${actual} / ${expected}`);
};

const campaigns = read("campaign");
const posts = read("post");
const queue = read("campaign-postrefreshqueue");

// what the source says
const CC_STATUS = {
  "1749228030762x636436422338022800": "COMPLETE",
  "1749228030702x337686101696905500": "IN_PROGRESS",
  "1749228031045x851842503930208900": "CANCELLED",
  "1749228031102x507523978686096100": "CANCELLED",
};
const srcStatus = {};
for (const c of campaigns) {
  const s = CC_STATUS[c.status] || "IN_PROGRESS";
  srcStatus[s] = (srcStatus[s] || 0) + 1;
}
const srcFetch = {};
for (const p of posts) {
  const s = { success: "LIVE", unavailable: "UNAVAILABLE", error: "ERROR" }[String(p.status || "").toLowerCase()] || "UNKNOWN";
  srcFetch[s] = (srcFetch[s] || 0) + 1;
}

console.log("ROW COUNTS");
check("mirror CcCampaign", await db.ccCampaign.count(), campaigns.length);
check("mirror CcPost", await db.ccPost.count(), posts.length);
check("mirror CcRefreshQueue", await db.ccRefreshQueue.count(), queue.length);
check("domain Campaign (imported)", await db.campaign.count({ where: { ccCampaignId: { not: null } } }), campaigns.length);
check("domain Post (imported)", await db.post.count({ where: { ccPostId: { not: null } } }), posts.length);

console.log("\nCAMPAIGN STATUS");
for (const [status, expected] of Object.entries(srcStatus)) {
  check(`status ${status}`, await db.campaign.count({ where: { ccCampaignId: { not: null }, status } }), expected);
}

console.log("\nPOST FETCH STATE");
for (const [fetchState, expected] of Object.entries(srcFetch)) {
  check(`fetchState ${fetchState}`, await db.post.count({ where: { ccPostId: { not: null }, fetchState } }), expected);
}

console.log("\nPARITY COLUMNS (must be populated for every imported row)");
check("Campaign.ccStatusId set", await db.campaign.count({ where: { ccCampaignId: { not: null }, ccStatusId: { not: null } } }), campaigns.length);
check("Campaign.ccSlug set", await db.campaign.count({ where: { ccCampaignId: { not: null }, ccSlug: { not: null } } }), campaigns.length);
check("Post.fetchState set", await db.post.count({ where: { ccPostId: { not: null }, fetchState: { not: null } } }), posts.length);
check("Post.postUrl set", await db.post.count({ where: { ccPostId: { not: null }, postUrl: { not: "" } } }), posts.length);

console.log("\nRELATIONAL INTEGRITY");
const orphan = await db.post.count({ where: { ccPostId: { not: null }, campaign: { ccCampaignId: null } } });
check("posts attached to an imported campaign", posts.length - orphan, posts.length);

if (fails.length) {
  console.error(`\n${fails.length} CHECK(S) FAILED:`);
  for (const f of fails) console.error("  - " + f);
  await db.$disconnect();
  process.exit(1);
}
console.log("\nAll checks reconciled against the extracted source.");
await db.$disconnect();
