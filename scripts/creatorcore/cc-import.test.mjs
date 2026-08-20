// Runnable check for the importer's data-correctness helpers (the parts that
// silently corrupt data if wrong). Run: node scripts/creatorcore/cc-import.test.mjs
import assert from "node:assert";
import { mapPlatform, mapCampaignStatus, mapPostStatus, mapCurrency, num, statFrom, platformPostIdFrom, toDate } from "./cc-import.mjs";

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
assert.equal(mapCampaignStatus("Completed"), "COMPLETE");
assert.equal(mapCampaignStatus("in progress"), "IN_PROGRESS");
assert.equal(mapCampaignStatus(undefined), "IN_PROGRESS");
assert.equal(mapPostStatus("Approved"), "APPROVED");
assert.equal(mapPostStatus("declined"), "REJECTED");
assert.equal(mapPostStatus("whatever"), "PENDING_REVIEW");
assert.equal(mapCurrency("$ USD"), "USD");
assert.equal(mapCurrency("₹ INR"), "INR");
assert.equal(mapCurrency("weird"), "USD");

// toDate: first valid wins, else null
assert.ok(toDate(null, "2026-07-15T20:36:22.901Z") instanceof Date);
assert.equal(toDate(null, "not-a-date"), null);

console.log("cc-import helpers: all assertions passed");
