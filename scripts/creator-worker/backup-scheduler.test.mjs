// node --test scripts/creator-worker/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TRIGGERS_PER_RUN,
  PER_JOB_COOLDOWN_MS,
  appOrigin,
  emptyState,
  loadState,
  runScheduler,
  saveState,
  selectTriggers,
  validOverdue,
} from "./backup-scheduler.mjs";

const SCHED = "s".repeat(32);
const CRON = "c".repeat(32);
const NOW = Date.parse("2026-10-02T12:00:00Z");
const job = (name, minutesOverdue) => ({ job: name, path: `/api/cron/${name}`, minutesOverdue });

/** A stand-in app: the overdue list behind SCHED, cron routes behind CRON, every request recorded. */
async function fakeApp({ overdue = [], recheckInMinutes = 0, listStatus = 200, cronStatus = 200 } = {}) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization ?? null });
    if (req.url === "/api/ops/overdue-crons") {
      if (req.headers.authorization !== `Bearer ${SCHED}`) return res.writeHead(401).end();
      res.writeHead(listStatus, { "content-type": "application/json" });
      return res.end(JSON.stringify({ overdue, recheckInMinutes }));
    }
    if (req.url?.startsWith("/api/cron/")) {
      if (req.headers.authorization !== `Bearer ${CRON}`) return res.writeHead(401).end();
      res.writeHead(cronStatus, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, detail: "@fake_handle_do_not_log" }));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

const run = (app, extra = {}) => {
  const lines = [];
  return runScheduler({
    appUrl: app.base,
    schedulerToken: SCHED,
    cronSecret: CRON,
    state: emptyState(),
    nowMs: NOW,
    gapMs: 0,
    log: (m) => lines.push(m),
    ...extra,
  }).then((result) => ({ result, lines }));
};

test("selects the most overdue first, at most five, once per job", () => {
  const overdue = ["a", "b", "c", "d", "e", "f", "g"].map((n, i) => job(`job-${n}`, 20 + i * 10));
  overdue.push(job("job-g", 5));
  const picks = selectTriggers(overdue, {}, NOW);
  assert.equal(picks.length, MAX_TRIGGERS_PER_RUN);
  assert.deepEqual(
    picks.map((p) => p.job),
    ["job-g", "job-f", "job-e", "job-d", "job-c"],
  );
});

test("a job triggered in the last 30 minutes is skipped, and frees no slot for itself", () => {
  const overdue = [job("sync-posts", 300), job("ops-canary", 100)];
  const last = { "sync-posts": NOW - PER_JOB_COOLDOWN_MS + 60_000 };
  assert.deepEqual(selectTriggers(overdue, last, NOW).map((p) => p.job), ["ops-canary"]);
  const later = { "sync-posts": NOW - PER_JOB_COOLDOWN_MS };
  assert.deepEqual(selectTriggers(overdue, later, NOW).map((p) => p.job), ["sync-posts", "ops-canary"]);
});

test("only /api/cron/<job> for a plain job name is ever callable", () => {
  assert.equal(validOverdue(job("sync-posts", 30)), true);
  for (const bad of [
    { job: "sync-posts", path: "/api/admin/migrate-ops-guards", minutesOverdue: 30 },
    { job: "sync-posts", path: "https://evil.example/api/cron/sync-posts", minutesOverdue: 30 },
    { job: "../admin", path: "/api/cron/../admin", minutesOverdue: 30 },
    { job: "Sync_Posts", path: "/api/cron/Sync_Posts", minutesOverdue: 30 },
    { job: "sync-posts", path: "/api/cron/sync-posts", minutesOverdue: "30" },
    null,
  ]) {
    assert.equal(validOverdue(bad), false, JSON.stringify(bad));
  }
});

test("APP_URL must be https, or http on loopback; never a TikTok host", () => {
  assert.equal(appOrigin("https://campaign.example.com/x"), "https://campaign.example.com");
  assert.equal(appOrigin("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
  for (const bad of ["http://campaign.example.com", "https://www.tiktok.com", "ftp://x", "nope", undefined]) {
    assert.throws(() => appOrigin(bad), String(bad));
  }
});

test("triggers each overdue cron with the cron secret and talks to nothing but the app", async () => {
  const app = await fakeApp({ overdue: [job("ops-canary", 40), job("sync-posts", 200)] });
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(String(url));
    return fetch(url, init);
  };
  try {
    const { result, lines } = await run(app, { fetchImpl });
    assert.deepEqual(result.triggered, [
      { job: "sync-posts", status: "200" },
      { job: "ops-canary", status: "200" },
    ]);
    assert.deepEqual(
      app.seen.map((s) => s.path),
      ["/api/ops/overdue-crons", "/api/cron/sync-posts", "/api/cron/ops-canary"],
    );
    assert.equal(app.seen[0].auth, `Bearer ${SCHED}`);
    assert.ok(app.seen.slice(1).every((s) => s.auth === `Bearer ${CRON}`));
    assert.ok(calls.every((u) => u.startsWith(`${app.base}/`)), "every request goes to APP_URL");

    const out = lines.join("\n");
    assert.doesNotMatch(out, /fake_handle|s{32}|c{32}|Bearer/);
    assert.match(out, /sync-posts/);
  } finally {
    await app.close();
  }
});

test("caps a run at five triggers and remembers them for the next run", async () => {
  const names = ["one", "two", "three", "four", "five", "six", "seven"].map((n) => `job-${n}`);
  const app = await fakeApp({ overdue: names.map((n, i) => job(n, 100 - i)) });
  const state = emptyState();
  try {
    const first = await run(app, { state });
    assert.equal(first.result.triggered.length, MAX_TRIGGERS_PER_RUN);
    assert.equal(app.seen.filter((s) => s.path.startsWith("/api/cron/")).length, MAX_TRIGGERS_PER_RUN);

    app.seen.length = 0;
    const second = await run(app, { state, nowMs: NOW + 10 * 60_000 });
    assert.deepEqual(second.result.triggered.map((t) => t.job), ["job-six", "job-seven"]);

    app.seen.length = 0;
    const third = await run(app, { state, nowMs: NOW + 20 * 60_000 });
    assert.deepEqual(third.result.triggered, [], "every job is inside its 30 minutes");
    assert.deepEqual(app.seen.map((s) => s.path), ["/api/ops/overdue-crons"]);

    const fourth = await run(app, { state, nowMs: NOW + 31 * 60_000 });
    assert.equal(fourth.result.triggered.length, MAX_TRIGGERS_PER_RUN);
  } finally {
    await app.close();
  }
});

test("waits for the app's recheck time before asking again, unless forced", async () => {
  const app = await fakeApp({ overdue: [], recheckInMinutes: 25 });
  const state = emptyState();
  try {
    await run(app, { state });
    assert.equal(state.nextAskAt, NOW + 25 * 60_000);

    app.seen.length = 0;
    const early = await run(app, { state, nowMs: NOW + 10 * 60_000 });
    assert.equal(early.result.asked, false);
    assert.deepEqual(app.seen, [], "no request at all, so the database stays asleep");

    await run(app, { state, nowMs: NOW + 10 * 60_000, force: true });
    assert.equal(app.seen.length, 1);

    app.seen.length = 0;
    await run(app, { state, nowMs: NOW + 36 * 60_000 });
    assert.equal(app.seen.length, 1);
  } finally {
    await app.close();
  }
});

test("never sleeps longer than an hour on the app's word", async () => {
  const app = await fakeApp({ recheckInMinutes: 10_000 });
  const state = emptyState();
  try {
    await run(app, { state });
    assert.equal(state.nextAskAt, NOW + 60 * 60_000);
  } finally {
    await app.close();
  }
});

test("ignores entries that are not a plain cron path", async () => {
  const app = await fakeApp({
    overdue: [{ job: "sync-posts", path: "/api/admin/migrate-ops-guards", minutesOverdue: 900 }, job("ops-canary", 30)],
  });
  try {
    const { result } = await run(app);
    assert.deepEqual(result.triggered.map((t) => t.job), ["ops-canary"]);
    assert.ok(!app.seen.some((s) => s.path.startsWith("/api/admin/")));
  } finally {
    await app.close();
  }
});

test("a dry run asks and calls nothing, and needs no cron secret", async () => {
  const app = await fakeApp({ overdue: [job("sync-posts", 60)] });
  const state = emptyState();
  try {
    const { result } = await run(app, { state, cronSecret: undefined, dryRun: true });
    assert.deepEqual(result.overdue, ["sync-posts"]);
    assert.deepEqual(result.triggered, []);
    assert.deepEqual(app.seen.map((s) => s.path), ["/api/ops/overdue-crons"]);
    assert.deepEqual(state, emptyState());
  } finally {
    await app.close();
  }
});

test("a refused list is an error and triggers nothing", async () => {
  const app = await fakeApp({ overdue: [job("sync-posts", 60)], listStatus: 503 });
  try {
    await assert.rejects(run(app), /overdue-crons answered 503/);
    assert.deepEqual(app.seen.map((s) => s.path), ["/api/ops/overdue-crons"]);
    await assert.rejects(run(app, { schedulerToken: "" }), /OPS_SCHEDULER_TOKEN/);
    await assert.rejects(run(app, { cronSecret: "" }), /CRON_SECRET/);
  } finally {
    await app.close();
  }
});

test("a failed trigger is reported by job name and status and still counts against the cooldown", async () => {
  const app = await fakeApp({ overdue: [job("sync-posts", 60)], cronStatus: 500 });
  const state = emptyState();
  try {
    const { result } = await run(app, { state });
    assert.deepEqual(result.triggered, [{ job: "sync-posts", status: "500" }]);
    assert.equal(state.lastTriggered["sync-posts"], NOW);
  } finally {
    await app.close();
  }
});

test("persists the stamps before the first call goes out", async () => {
  const app = await fakeApp({ overdue: [job("sync-posts", 60)] });
  const snapshots = [];
  try {
    await run(app, {
      persist: (s) => snapshots.push({ stamped: s.lastTriggered["sync-posts"], calls: app.seen.filter((x) => x.path.startsWith("/api/cron/")).length }),
    });
    assert.deepEqual(snapshots, [{ stamped: NOW, calls: 0 }]);
  } finally {
    await app.close();
  }
});

test("state survives a round trip and drops stamps older than a day", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backup-scheduler-"));
  const file = join(dir, "nested", "state.json");
  const app = await fakeApp({ overdue: [job("ops-canary", 30)] });
  try {
    assert.deepEqual(loadState(file), emptyState());
    const state = { lastTriggered: { "old-job": NOW - 25 * 60 * 60_000 }, nextAskAt: 0 };
    await run(app, { state, persist: (s) => saveState(file, s) });
    const back = loadState(file);
    assert.deepEqual(Object.keys(back.lastTriggered), ["ops-canary"]);
    assert.doesNotMatch(readFileSync(file, "utf8"), /s{32}|c{32}/);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
