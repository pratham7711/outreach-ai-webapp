// Plan B's page-fetch service (plan §07, T6): one small process on a VM on a
// non-AWS network that fetches TikTok pages for the tracker reader, and does
// nothing else.
//
//   POST /fetch   {"url":"https://www.tiktok.com/@handle"}  ->  {"status":200,"body":"<html…","ms":812}
//   GET  /healthz                                           ->  {"ok":true,"served":…,"queued":…}
//
// What keeps it from being anything more than that:
//   - tiktok.com pages only, over https. A leaked token fetches TikTok pages
//     and nothing else, so it cannot be turned into a general proxy.
//   - A bearer token, compared in constant time. No token configured, no start.
//   - Its own pace: one upstream request at a time, at least FETCH_MIN_GAP_MS
//     apart (1.8 s, the rate measured to keep a single address at 100% full
//     pages), whatever the callers do. A queue deeper than FETCH_MAX_QUEUE is
//     refused with 429 rather than letting waits grow past the caller's timeout.
//   - No database credentials, no app secrets, no handles in its logs.
//   - TLS when FETCH_TLS_CERT and FETCH_TLS_KEY are set; otherwise it binds
//     127.0.0.1 and expects a TLS proxy (Caddy) in front of it.
//
// The page is fetched with curl and the same flags as Plan A's Sandbox lanes
// (lib/platforms/tiktokExit.ts), so A and B differ only in where the request
// leaves from. Zero npm dependencies: node and curl are the whole install.
import { execFile } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const META = "\n__EXIT_META__ ";
const MAX_REQUEST_BYTES = 4096;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

export function isTikTokPageUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "www.tiktok.com" || u.hostname === "tiktok.com");
  } catch {
    return false;
  }
}

/** The page, by curl, exactly as a Plan A lane fetches it. */
export function curlPage(url) {
  return new Promise((resolve) => {
    execFile(
      "curl",
      [
        "-sL",
        "--compressed",
        "--max-time",
        "20",
        "-A",
        UA,
        "-H",
        "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "-H",
        "accept-language: en-US,en;q=0.9",
        "-w",
        `${META}%{http_code}`,
        url,
      ],
      { maxBuffer: MAX_PAGE_BYTES + 1024, timeout: 30_000 },
      (_err, stdout) => {
        const out = String(stdout ?? "");
        const i = out.lastIndexOf(META);
        if (i < 0) return resolve(null);
        const status = Number(out.slice(i + META.length).trim().split(/\s+/)[0]);
        if (!Number.isFinite(status) || status <= 0) return resolve(null);
        resolve({ status, body: out.slice(0, i) });
      }
    );
  });
}

/** One upstream request at a time, minGapMs (+ jitter) apart. */
export function createPacer({ minGapMs, jitterMs, maxQueue, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let tail = Promise.resolve();
  let last = 0;
  let queued = 0;
  return {
    get queued() {
      return queued;
    },
    /** Resolves with task()'s result, or null when the queue is full. */
    run(task) {
      if (queued >= maxQueue) return null;
      queued++;
      const turn = tail.then(async () => {
        const wait = last + minGapMs + Math.floor(Math.random() * (jitterMs + 1)) - now();
        if (wait > 0) await sleep(wait);
        last = now();
        try {
          return await task();
        } finally {
          queued--;
        }
      });
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

function tokenMatches(header, token) {
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        /* Drain and answer rather than cut the socket, so the caller gets a
           413 instead of a connection reset. */
        req.removeAllListeners("data");
        req.resume();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

/**
 * The request handler, with its upstream injectable so the tests never touch
 * TikTok. Counters only -- a URL carries a creator's handle and is not logged.
 */
export function createFetchHandler({ token, fetchUpstream = curlPage, pacer, log = () => {} }) {
  if (!token || token.length < 24) throw new Error("FETCH_TOKEN must be set, 24+ characters");
  const stats = { served: 0, refused: 0, failed: 0, startedAt: new Date().toISOString() };
  const send = (res, code, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(body);
  };

  return async function handle(req, res) {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/healthz") {
      return send(res, 200, { ok: true, ...stats, queued: pacer.queued });
    }
    if (path !== "/fetch") return send(res, 404, { error: "not found" });
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });
    if (!tokenMatches(req.headers.authorization, token)) {
      stats.refused++;
      return send(res, 401, { error: "unauthorized" });
    }
    const raw = await readBody(req, MAX_REQUEST_BYTES);
    if (raw === null) return send(res, 413, { error: "request too large" });
    let url;
    try {
      url = JSON.parse(raw).url;
    } catch {
      return send(res, 400, { error: "invalid JSON" });
    }
    if (!isTikTokPageUrl(url)) {
      stats.refused++;
      return send(res, 400, { error: "tiktok.com pages only" });
    }
    const started = Date.now();
    const turn = pacer.run(() => fetchUpstream(url));
    if (turn === null) return send(res, 429, { error: "queue full" });
    const page = await turn.catch(() => null);
    if (!page) {
      stats.failed++;
      log(`fetch failed after ${Date.now() - started}ms`);
      return send(res, 502, { error: "upstream fetch failed" });
    }
    stats.served++;
    return send(res, 200, { status: page.status, body: page.body, ms: Date.now() - started });
  };
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function startFromEnv(env = process.env) {
  const pacer = createPacer({
    minGapMs: envInt("FETCH_MIN_GAP_MS", 1800),
    jitterMs: envInt("FETCH_JITTER_MS", 400),
    maxQueue: envInt("FETCH_MAX_QUEUE", 20),
  });
  const handler = createFetchHandler({
    token: env.FETCH_TOKEN,
    pacer,
    log: (m) => console.log(`${new Date().toISOString()} ${m}`),
  });
  const tls = env.FETCH_TLS_CERT && env.FETCH_TLS_KEY;
  const server = tls
    ? createHttpsServer({ cert: readFileSync(env.FETCH_TLS_CERT), key: readFileSync(env.FETCH_TLS_KEY) }, handler)
    : createHttpServer(handler);
  server.requestTimeout = 120_000;
  const port = envInt("FETCH_PORT", 8787);
  const host = env.FETCH_HOST ?? (tls ? "0.0.0.0" : "127.0.0.1");
  server.listen(port, host, () => console.log(`fetch-server listening on ${tls ? "https" : "http"}://${host}:${port}`));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) startFromEnv();
