// Plan B's daily check (plan §07): 12 public brand profiles and 3 embeds read
// THROUGH this box's own fetch service, and the result posted to the app's
// health endpoint. It is how prod knows B is alive while B carries no prod
// reads; the ops page refuses to switch to B unless the last check is fresh
// and passing, and two failures in a row alert the operator.
//
//   node daily-check.mjs               read, report, exit 0 on a pass
//   node daily-check.mjs --no-report   read and print only
//
// Env: FETCH_URL (default http://127.0.0.1:8787), FETCH_TOKEN, APP_URL,
// TRACKER_PLAN_B_HEALTH_TOKEN. Public brand and celebrity accounts only.
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";

export const PROFILES = ["tiktok", "khaby.lame", "charlidamelio", "mrbeast", "bellapoarch", "zachking", "willsmith", "nba", "espn", "natgeo", "nasa", "jimmyfallon"];
export const EMBEDS = ["tiktok", "nasa", "natgeo"];
const BLOB = /id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

/** Same reading of a page as the app's parser: a profile with a follower
 *  count, a "no such account" answer, or a wall. */
export function classifyProfile(page) {
  if (!page) return "failure";
  if (page.status === 403 || page.status === 429 || page.status >= 500) return "wall";
  if (page.status !== 200) return "failure";
  const m = BLOB.exec(page.body);
  if (!m) return "wall";
  let d;
  try {
    d = JSON.parse(m[1]);
  } catch {
    return "wall";
  }
  const s = d?.__DEFAULT_SCOPE__ ?? {};
  const u = s["webapp.user-detail"];
  if (!u?.userInfo) return u?.statusCode === 10221 || u?.statusCode === 10202 ? "proper" : "wall";
  const f = Number(u.userInfo.statsV2?.followerCount ?? u.userInfo.stats?.followerCount);
  return Number.isFinite(f) ? "proper" : "wall";
}

export const dailyCheckPassed = (reads, proper) => reads >= 12 && proper / reads >= 0.9;

export async function runCheck({ fetchUrl, fetchToken, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const startedAt = new Date();
  const counts = { reads: 0, proper: 0, walls: 0, failures: 0 };
  const latencies = [];
  const ask = async (url) => {
    try {
      const res = await fetchImpl(`${fetchUrl.replace(/\/+$/, "")}/fetch`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${fetchToken}` },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.ms === "number") latencies.push(data.ms);
      return data;
    } catch {
      return null;
    }
  };
  for (const h of PROFILES) {
    const verdict = classifyProfile(await ask(`https://www.tiktok.com/@${h}`));
    counts.reads++;
    if (verdict === "proper") counts.proper++;
    else if (verdict === "wall") counts.walls++;
    else counts.failures++;
    await sleep(200);
  }
  const embeds = { list: 0, none: 0 };
  for (const h of EMBEDS) {
    const page = await ask(`https://www.tiktok.com/embed/@${h}`);
    if (page && page.status === 200 && /"playCount"\s*:/.test(page.body)) embeds.list++;
    else embeds.none++;
  }
  latencies.sort((a, b) => a - b);
  return {
    kind: "daily-check",
    ...counts,
    medianMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    embeds,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    passed: dailyCheckPassed(counts.reads, counts.proper),
  };
}

function curlText(url) {
  return new Promise((resolve) => {
    execFile("curl", ["-fsS", "--max-time", "8", url], (err, out) => resolve(err ? "" : String(out).trim()));
  });
}

async function main() {
  const fetchUrl = process.env.FETCH_URL ?? "http://127.0.0.1:8787";
  const fetchToken = process.env.FETCH_TOKEN;
  if (!fetchToken) throw new Error("FETCH_TOKEN is required");
  const result = await runCheck({ fetchUrl, fetchToken });
  result.network = (await curlText("https://ipinfo.io/org")).slice(0, 80);
  result.where = (await curlText("https://ipinfo.io/country")).slice(0, 8);
  console.log(JSON.stringify(result));

  if (!process.argv.includes("--no-report")) {
    const app = process.env.APP_URL;
    const token = process.env.TRACKER_PLAN_B_HEALTH_TOKEN;
    if (!app || !token) throw new Error("APP_URL and TRACKER_PLAN_B_HEALTH_TOKEN are required to report");
    const res = await fetch(`${app.replace(/\/+$/, "")}/api/trackers/source-health`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`reported: ${res.status}`);
    if (!res.ok) process.exitCode = 2;
  }
  if (!result.passed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 3;
  });
}
