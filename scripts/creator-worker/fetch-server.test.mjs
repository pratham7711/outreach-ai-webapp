// node --test scripts/creator-worker/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createFetchHandler, createPacer, isTikTokPageUrl } from "./fetch-server.mjs";
import { classifyProfile, dailyCheckPassed, runCheck } from "./daily-check.mjs";

const TOKEN = "t".repeat(32);
const PROFILE = (followers) =>
  `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: { stats: { followerCount: followers } } } },
  })}</script>`;

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

const post = (base, body, token = TOKEN) =>
  fetch(`${base}/fetch`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("only https tiktok.com pages are fetchable", () => {
  assert.equal(isTikTokPageUrl("https://www.tiktok.com/@nasa"), true);
  assert.equal(isTikTokPageUrl("https://tiktok.com/embed/@nasa"), true);
  for (const bad of ["http://www.tiktok.com/@nasa", "https://evil.com/?u=tiktok.com", "https://www.tiktok.com.evil.com/", "https://169.254.169.254/", "file:///etc/passwd", "nope"]) {
    assert.equal(isTikTokPageUrl(bad), false, bad);
  }
});

test("refuses to start without a long token", () => {
  assert.throws(() => createFetchHandler({ token: "", pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 5 }) }));
  assert.throws(() => createFetchHandler({ token: "short", pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 5 }) }));
});

test("serves a page to the token holder and refuses everyone and everything else", async () => {
  const seen = [];
  const handler = createFetchHandler({
    token: TOKEN,
    pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 5 }),
    fetchUpstream: async (url) => {
      seen.push(url);
      return { status: 200, body: PROFILE(42) };
    },
  });
  const s = await serve(handler);
  try {
    const ok = await post(s.base, { url: "https://www.tiktok.com/@nasa" });
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.equal(data.status, 200);
    assert.match(data.body, /followerCount/);

    assert.equal((await post(s.base, { url: "https://www.tiktok.com/@nasa" }, null)).status, 401);
    assert.equal((await post(s.base, { url: "https://www.tiktok.com/@nasa" }, "x".repeat(32))).status, 401);
    assert.equal((await post(s.base, { url: "https://example.com/" })).status, 400);
    assert.equal((await post(s.base, "{not json")).status, 400);
    assert.equal((await post(s.base, { url: "https://www.tiktok.com/@" + "a".repeat(5000) })).status, 413);
    assert.equal((await fetch(`${s.base}/fetch`)).status, 405);
    assert.equal((await fetch(`${s.base}/other`)).status, 404);

    const health = await (await fetch(`${s.base}/healthz`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.served, 1);
    assert.equal(seen.length, 1, "nothing refused ever reached upstream");
  } finally {
    await s.close();
  }
});

test("an upstream failure is a 502, never a page", async () => {
  const handler = createFetchHandler({
    token: TOKEN,
    pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 5 }),
    fetchUpstream: async () => null,
  });
  const s = await serve(handler);
  try {
    assert.equal((await post(s.base, { url: "https://www.tiktok.com/@nasa" })).status, 502);
  } finally {
    await s.close();
  }
});

test("keeps its own pace however fast the callers ask", async () => {
  const starts = [];
  const handler = createFetchHandler({
    token: TOKEN,
    pacer: createPacer({ minGapMs: 60, jitterMs: 0, maxQueue: 20 }),
    fetchUpstream: async () => {
      starts.push(Date.now());
      return { status: 200, body: "x" };
    },
  });
  const s = await serve(handler);
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => post(s.base, { url: "https://www.tiktok.com/@nasa" })));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 55, `gap ${starts[i] - starts[i - 1]}ms`);
  } finally {
    await s.close();
  }
});

test("refuses a queue deeper than its limit instead of letting waits grow", async () => {
  const handler = createFetchHandler({
    token: TOKEN,
    pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 4 }),
    fetchUpstream: () => new Promise((r) => setTimeout(() => r({ status: 200, body: "x" }), 400)),
  });
  const s = await serve(handler);
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => post(s.base, { url: "https://www.tiktok.com/@nasa" })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 429, 429]);
  } finally {
    await s.close();
  }
});

test("the daily check reads 12 profiles and 3 embeds through the service and judges them like the app", async () => {
  const handler = createFetchHandler({
    token: TOKEN,
    pacer: createPacer({ minGapMs: 0, jitterMs: 0, maxQueue: 20 }),
    fetchUpstream: async (url) =>
      url.includes("/embed/")
        ? { status: 200, body: '{"playCount": 5}' }
        : url.endsWith("@nba")
          ? { status: 200, body: "<html>login</html>" }
          : { status: 200, body: PROFILE(1000) },
  });
  const s = await serve(handler);
  try {
    const r = await runCheck({ fetchUrl: s.base, fetchToken: TOKEN, sleep: async () => {} });
    assert.equal(r.reads, 12);
    assert.equal(r.proper, 11);
    assert.equal(r.walls, 1);
    assert.deepEqual(r.embeds, { list: 3, none: 0 });
    assert.equal(r.passed, true);
  } finally {
    await s.close();
  }
});

test("page verdicts and the pass mark", () => {
  assert.equal(classifyProfile(null), "failure");
  assert.equal(classifyProfile({ status: 429, body: "" }), "wall");
  assert.equal(classifyProfile({ status: 200, body: PROFILE(10) }), "proper");
  assert.equal(classifyProfile({ status: 200, body: "<html></html>" }), "wall");
  assert.equal(dailyCheckPassed(12, 11), true);
  assert.equal(dailyCheckPassed(12, 10), false);
  assert.equal(dailyCheckPassed(11, 11), false);
});
