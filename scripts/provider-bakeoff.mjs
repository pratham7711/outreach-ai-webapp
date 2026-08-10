// Compares paid TikTok metrics providers on identical post URLs.
//
//   BAKEOFF_ENSEMBLEDATA=... BAKEOFF_SCRAPECREATORS=... node scripts/provider-bakeoff.mjs
//
// Any provider whose key is absent is skipped and reported as such. Ground truth for
// posts we own comes from TikTok's own Display API, so accuracy is measured, not assumed.

const GROUND_TRUTH = {
  "7672247264642993430": { views: 28, likes: 0, comments: 0, shares: 0 },
  "7672246888057343254": { views: 28, likes: 0, comments: 0, shares: 0 },
};

const URLS = [
  "https://www.tiktok.com/@clipvault6260/video/7672247264642993430",
  "https://www.tiktok.com/@clipvault6260/video/7672246888057343254",
  "https://www.tiktok.com/@khaby.lame/video/7137723462233443589",
];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

const PROVIDERS = [
  {
    name: "EnsembleData",
    env: "BAKEOFF_ENSEMBLEDATA",
    // Verified against ensembledata.com/apis/docs: /tt/post/info, token query param.
    async run(url, key, signal) {
      const res = await fetch(
        `https://ensembledata.com/apis/tt/post/info?url=${encodeURIComponent(url)}&token=${encodeURIComponent(key)}`,
        { signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const s = j?.data?.statistics ?? j?.data?.[0]?.statistics ?? j?.statistics ?? {};
      return {
        views: num(s.play_count),
        likes: num(s.digg_count),
        comments: num(s.comment_count),
        shares: num(s.share_count),
      };
    },
  },
  {
    name: "ScrapeCreators",
    env: "BAKEOFF_SCRAPECREATORS",
    // Verified header/base from docs.scrapecreators.com; response shape unconfirmed
    // without a key, so field lookup is defensive.
    async run(url, key, signal) {
      const res = await fetch(
        `https://api.scrapecreators.com/v2/tiktok/video?url=${encodeURIComponent(url)}`,
        { headers: { "x-api-key": key }, signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const s = j?.aweme_detail?.statistics ?? j?.statistics ?? j?.data?.statistics ?? j ?? {};
      return {
        views: num(s.play_count ?? s.playCount ?? s.views),
        likes: num(s.digg_count ?? s.diggCount ?? s.likes),
        comments: num(s.comment_count ?? s.commentCount ?? s.comments),
        shares: num(s.share_count ?? s.shareCount ?? s.shares),
      };
    },
  },
  {
    name: "Apify/clockworks",
    env: "BAKEOFF_APIFY",
    async run(url, key, signal) {
      const res = await fetch(
        `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postURLs: [url], resultsPerPage: 1 }),
          signal,
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const it = Array.isArray(j) ? j[0] : j;
      return {
        views: num(it?.playCount),
        likes: num(it?.diggCount),
        comments: num(it?.commentCount),
        shares: num(it?.shareCount),
      };
    },
  },
  {
    name: "SocialKit",
    env: "SOCIALKIT_API_KEY",
    async run(url, key, signal) {
      const res = await fetch(
        `https://api.socialkit.dev/tiktok/stats?access_key=${encodeURIComponent(key)}&url=${encodeURIComponent(url)}`,
        { signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const d = j?.data ?? {};
      return {
        views: num(d.views),
        likes: num(d.likes),
        comments: num(d.comments),
        shares: num(d.shares),
      };
    },
  },
];

function idOf(url) {
  return url.match(/\/video\/(\d+)/)?.[1] ?? url;
}

async function timed(fn) {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message, ms: Date.now() - t0 };
  }
}

const active = PROVIDERS.filter((p) => process.env[p.env]);
const skipped = PROVIDERS.filter((p) => !process.env[p.env]);

if (skipped.length) {
  console.log(`skipped (no key): ${skipped.map((p) => `${p.name} [${p.env}]`).join(", ")}`);
}
if (!active.length) {
  console.log("\nNo provider keys set — nothing to compare.");
  process.exit(0);
}

const rows = [];
for (const provider of active) {
  const key = process.env[provider.env];
  for (const url of URLS) {
    const id = idOf(url);
    const r = await timed(() =>
      provider.run(url, key, AbortSignal.timeout(30000)),
    );
    const truth = GROUND_TRUTH[id];
    let verdict = "—";
    if (r.ok && truth) {
      verdict = r.value.views === truth.views ? "EXACT" : `off by ${r.value.views - truth.views}`;
    }
    rows.push({
      provider: provider.name,
      post: id.slice(-6),
      ms: r.ms,
      views: r.ok ? r.value.views : "-",
      likes: r.ok ? r.value.likes : "-",
      comments: r.ok ? r.value.comments : "-",
      shares: r.ok ? r.value.shares : "-",
      vsTruth: verdict,
      error: r.ok ? "" : r.error,
    });
  }
}

console.table(rows);

const byProvider = new Map();
for (const r of rows) {
  const agg = byProvider.get(r.provider) ?? { calls: 0, ok: 0, exact: 0, totalMs: 0, truthed: 0 };
  agg.calls++;
  agg.totalMs += r.ms;
  if (!r.error) agg.ok++;
  if (r.vsTruth !== "—") {
    agg.truthed++;
    if (r.vsTruth === "EXACT") agg.exact++;
  }
  byProvider.set(r.provider, agg);
}

console.log("\nsummary");
for (const [name, a] of byProvider) {
  console.log(
    `  ${name}: ${a.ok}/${a.calls} succeeded, ${a.exact}/${a.truthed} exact vs ground truth, avg ${Math.round(a.totalMs / a.calls)}ms`,
  );
}
