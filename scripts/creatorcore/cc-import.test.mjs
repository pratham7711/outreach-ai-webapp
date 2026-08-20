// Runnable check for the importer's data-correctness helpers (the parts that
// silently corrupt data if wrong). Run: node scripts/creatorcore/cc-import.test.mjs
import assert from "node:assert";
import { mapPlatform, mapCampaignStatus, mapPostStatus, mapFetchState, mapCurrency, num, statFrom, platformPostIdFrom, toDate, bool, fnum, ccCampaignData, ccPostData } from "./cc-import.mjs";

// platform: explicit text, then URL inference, then default
assert.equal(mapPlatform("TikTok"), "TIKTOK");
assert.equal(mapPlatform("Instagram Reels"), "INSTAGRAM");
assert.equal(mapPlatform("", "https://www.youtube.com/shorts/abc"), "YOUTUBE");
assert.equal(mapPlatform("", "https://x.com/u/status/1"), "TWITTER");
assert.equal(mapPlatform(null, "weird://none"), "TIKTOK");

// platformPostId: pull the id out of real URL shapes, fall back to CC _id
assert.equal(platformPostIdFrom("https://www.tiktok.com/@u/video/7300001234567890", "x"), "7300001234567890");
assert.equal(platformPostIdFrom("https://www.instagram.com/reel/CxYz-1/", "x"), "CxYz-1");
assert.equal(platformPostIdFrom("https://youtube.com/shorts/AbC123", "x"), "AbC123");
assert.equal(platformPostIdFrom("", "cc-fallback-id"), "cc-fallback-id");

// num: coerce messy strings without throwing
assert.equal(num(1234), 1234);
assert.equal(num("1,234,567"), 1234567);
assert.equal(num("12.5% eng"), 12.5);
assert.equal(num(null), 0);

// statFrom: fuzzy-match a stat by candidate key names, skip zeros
assert.equal(statFrom({ playCount: 999, likeCount: 5 }, "view", "play"), 999);
assert.equal(statFrom({ Likes: "1,000" }, "like", "heart"), 1000);
assert.equal(statFrom({ nothing: 1 }, "view"), 0);
assert.equal(statFrom(null, "view"), 0);

// enum maps
// Campaign status arrives as an org-activationstatus REFERENCE ID, not a label.
// These four IDs were verified by driving CreatorCore's own status tabs and
// matching their counts: Complete 497, Active 4, Canceled 3+2, Pending 0 = 506.
assert.equal(mapCampaignStatus("1749228030762x636436422338022800"), "COMPLETE");
assert.equal(mapCampaignStatus("1749228030702x337686101696905500"), "IN_PROGRESS");
assert.equal(mapCampaignStatus("1749228031045x851842503930208900"), "CANCELLED");
assert.equal(mapCampaignStatus("1749228031102x507523978686096100"), "CANCELLED");
// string fallback still works if the source ever returns labels
assert.equal(mapCampaignStatus("Completed"), "COMPLETE");
assert.equal(mapCampaignStatus(undefined), "IN_PROGRESS");

// Post fetch state is its own dimension; approval status must NOT be inferred
// from it (importing must never fabricate an approval a human never made).
assert.equal(mapFetchState("Success"), "LIVE");
assert.equal(mapFetchState("Unavailable"), "UNAVAILABLE");
assert.equal(mapFetchState("Error"), "ERROR");
assert.equal(mapFetchState(undefined), "UNKNOWN");
assert.equal(mapPostStatus("Success"), "PENDING_REVIEW");
assert.equal(mapPostStatus("Unavailable"), "PENDING_REVIEW");
assert.equal(mapPostStatus("Approved"), "APPROVED");
assert.equal(mapPostStatus("declined"), "REJECTED");
assert.equal(mapCurrency("$ USD"), "USD");
assert.equal(mapCurrency("₹ INR"), "INR");
assert.equal(mapCurrency("weird"), "USD");

// toDate: first valid wins, else null
assert.ok(toDate(null, "2026-07-15T20:36:22.901Z") instanceof Date);
assert.equal(toDate(null, "not-a-date"), null);

// bool / fnum coercion
assert.equal(bool(true), true);
assert.equal(bool("yes"), true);
assert.equal(bool("no"), false);
assert.equal(bool(undefined), null);
assert.equal(fnum(12), 12);
assert.equal(fnum("3.5"), 3.5);
assert.equal(fnum(""), null);
assert.equal(fnum(undefined), null);

// ── mirror mappers: every known field promoted to a column, raw preserved whole ──
const CAMPAIGN_KEYS = ["_id","Modified Date","Created Date","Created By","posts","activations","budget","creatorProfiles","fullID","id","metatags","modules","organization","recentSnapshot","refreshInterval","snapshots","status","thumbnail","title","nextSnapshotWorkflow","activity","creatorRateTotals","commissionTotal","profitTotal","currency","postRefreshAnchor","Campaign Managers","Archive","lastRefresh","urlPreview","refreshActive","activationColumns","views","displayPlatforms","tempComplete","satellite","viewMigrateComplete","actionColumnAdded","defaultDeliverableViewAdded","sudo-slug"];
const sampleCampaign = Object.fromEntries(CAMPAIGN_KEYS.map((k) => {
  if (k === "_id") return [k, "camp1"];
  if (k === "id") return [k, 42];
  if (["budget","creatorRateTotals","commissionTotal","profitTotal","refreshInterval"].includes(k)) return [k, 100];
  if (["Archive","refreshActive","tempComplete","viewMigrateComplete","actionColumnAdded","defaultDeliverableViewAdded"].includes(k)) return [k, true];
  if (["posts","activations","creatorProfiles","metatags","modules","snapshots","activity","Campaign Managers","activationColumns","views","displayPlatforms"].includes(k)) return [k, ["x"]];
  if (["Created Date","Modified Date","postRefreshAnchor","lastRefresh"].includes(k)) return [k, "2026-07-15T20:36:22.901Z"];
  return [k, "v_" + k];
}));
const cc = ccCampaignData(sampleCampaign, "org1");
assert.equal(cc.orgId, "org1");
assert.equal(cc.ccId, "camp1");
assert.equal(cc.ccNumericId, 42);
assert.equal(cc.fullId, "v_fullID");        // tricky rename fullID -> fullId
assert.equal(cc.sudoSlug, "v_sudo-slug");   // tricky key sudo-slug -> sudoSlug
assert.deepEqual(cc.campaignManagers, ["x"]); // "Campaign Managers" -> campaignManagers
assert.equal(cc.archive, true);
assert.ok(cc.createdDate instanceof Date);
assert.deepEqual(cc.raw, sampleCampaign);   // nothing lost
// every promoted column is non-undefined (present) for a full record
for (const [k, v] of Object.entries(cc)) assert.notEqual(v, undefined, `campaign column ${k} undefined`);

const samplePost = {
  _id: "post1", campaign: "camp1", organization: "org-src", lastStatistics: "stat1",
  "latestViews/Engagement": 12345, platform: "p", platformTEXT: "TikTok", postUrl: "https://tiktok.com/@u/video/1",
  status: "approved", thumbnail: "t", username: "u", authorProfilePic: "a", "Created By": "cb",
  createdByUser: "cbu", isInstagramStory: false, autoAdd: true, heicConvert: false,
  postDate: "2026-07-15T20:36:22.901Z", lastFresh: "2026-07-16T00:00:00.000Z",
  "Created Date": "2026-07-01T00:00:00.000Z", "Modified Date": "2026-07-10T00:00:00.000Z",
};
const cp = ccPostData(samplePost, "org1");
assert.equal(cp.ccId, "post1");
assert.equal(cp.latestViewsEngagement, 12345); // "latestViews/Engagement" -> latestViewsEngagement
assert.equal(cp.platformText, "TikTok");        // platformTEXT -> platformText
assert.equal(cp.isInstagramStory, false);
assert.ok(cp.postDate instanceof Date);
assert.deepEqual(cp.raw, samplePost);           // nothing lost
for (const [k, v] of Object.entries(cp)) assert.notEqual(v, undefined, `post column ${k} undefined`);

console.log("cc-import helpers: all assertions passed");
