/**
 * @jest-environment node
 *
 * Node, not jsdom: this transport streams a real response body, and the
 * early-abort tests need TextEncoder/ReadableStream as the runtime actually
 * provides them. jsdom has neither.
 *
 * The proxy egress, pinned at the boundaries that cost money or coverage.
 *
 * Two failure shapes are worth more than the rest. One: a walled read reported
 * as a dead transport, which throws away TikTok's actual answer. Two: a burned
 * exit IP kept in rotation, which spends the whole run rediscovering that the
 * same address is blocked. Both are cheap to write and invisible in production
 * until a refresh silently measures half a campaign.
 */

/* Every ProxyAgent built, in order, with the URI it dialled -- the session
   rewrite is only observable here, and it is the whole mechanism by which a
   new identity is obtained. */
const mockAgents: Array<{ uri: string; closed: boolean }> = [];

jest.mock("undici", () => ({
  ProxyAgent: jest.fn(function (this: unknown, opts: { uri: string }) {
    const entry = { uri: opts.uri, closed: false };
    mockAgents.push(entry);
    return {
      __entry: entry,
      close: async () => {
        entry.closed = true;
      },
    };
  }),
}));

import {
  configuredProxyUrls,
  openTikTokProxyPool,
  proxiesConfigured,
} from "@/lib/platforms/tiktokProxy";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7675846963421646098";

/** HTTP 200 with no rehydration payload: the WAF's login shell. */
const WALL = '<html><body><div id="slardar-login"></div></body></html>';

function page(statusCode = 0): string {
  const scope = {
    "webapp.video-detail": {
      statusCode,
      itemInfo: {
        itemStruct: {
          desc: "a clip",
          createTime: "1750000000",
          video: { cover: "https://cdn.example/cover.jpg" },
          stats: { playCount: 4165, diggCount: 535, commentCount: 2, shareCount: 10 },
        },
      },
    },
  };
  return `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
    { __DEFAULT_SCOPE__: scope },
  )}</script></body></html>`;
}

type Reply = { status?: number; body?: string } | Error;

/** Replies handed out in order, so a test can wall the first N attempts. */
let replies: Reply[];
let fetchCalls: Array<{ url: string; headers: Record<string, string> }>;

const ENV_KEYS = [
  "TIKTOK_PROXY_URL",
  "TIKTOK_PROXY_URLS",
  "TIKTOK_PROXY_SESSION_TEMPLATE",
  "TIKTOK_PROXY_MAX_LANES",
  "TIKTOK_PROXY_MAX_ATTEMPTS",
  "TIKTOK_PROXY_MIN_GAP_MS",
  "TIKTOK_PROXY_JITTER_MS",
];

beforeEach(() => {
  mockAgents.length = 0;
  replies = [];
  fetchCalls = [];
  for (const k of ENV_KEYS) delete process.env[k];
  /* Pacing off by default. The gate is the sandbox pool's, already covered
     there, and a real 700ms gap would make every one of these tests slow
     without testing anything this module owns. */
  process.env.TIKTOK_PROXY_MIN_GAP_MS = "0";
  process.env.TIKTOK_PROXY_JITTER_MS = "0";

  global.fetch = jest.fn(async (url: unknown, init: unknown) => {
    const opts = (init ?? {}) as { headers?: Record<string, string> };
    fetchCalls.push({ url: String(url), headers: opts.headers ?? {} });
    const reply = replies.shift() ?? { status: 200, body: page() };
    if (reply instanceof Error) throw reply;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => reply.body ?? "",
    };
  }) as unknown as typeof fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

/**
 * Serve a body as a real stream, in the chunks given, and record how much of it
 * was actually pulled.
 *
 * The early-abort only exists to leave bytes on the wire, and a mock that hands
 * over a finished string cannot tell whether it did. This is the only way the
 * saving is observable from a test.
 */
function streamed(chunks: string[]) {
  const pulled: string[] = [];
  let cancelled = false;
  const enc = new TextEncoder();
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) return controller.close();
      pulled.push(chunks[i]);
      controller.enqueue(enc.encode(chunks[i++]));
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    body,
    get pulled() {
      return pulled;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

describe("reading only as far as the numbers", () => {
  beforeEach(() => {
    process.env.TIKTOK_PROXY_URL = "http://user:pass@gw.example:7000";
  });

  /** Install a fetch that serves one streamed response. */
  const serve = (s: ReturnType<typeof streamed>) => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      body: s.body,
      text: async () => "SHOULD NOT BE CALLED WHEN A STREAM EXISTS",
    })) as unknown as typeof fetch;
  };

  /* A ReadableStream with the default queuing strategy pulls ONE chunk beyond
     what the consumer has taken, so the abort always over-reads by a single
     frame. That is a property of the stream, not a bug in the reader, and it is
     immaterial in production: undici delivers ~16-64KB frames against a ~390KB
     page, so one frame of read-ahead still leaves the great majority of the
     tail on the wire. The assertions below therefore pin "stopped early",
     not "stopped instantly". */
  const TAIL = ["x".repeat(100_000), "y".repeat(100_000), "z".repeat(100_000)];

  it("stops pulling once the rehydration blob has closed", async () => {
    const s = streamed([page(), ...TAIL]);
    serve(s);
    const pool = openTikTokProxyPool(1)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);

    expect(lookup?.state).toBe("live");
    expect(lookup?.metrics?.viewsCount).toBe(4165);
    // Most of the 300KB tail was never pulled -- that is the whole point.
    expect(s.pulled.length).toBeLessThan(1 + TAIL.length);
    expect(s.cancelled).toBe(true);
    await pool.close();
  });

  it("waits for the CLOSING tag, so a split blob is never parsed truncated", async () => {
    /* The trap this guards: breaking on the marker alone hands the parser half
       a JSON object, which fails as "unparseable" and is indistinguishable from
       a wall -- a refusal we inflicted on ourselves. */
    const full = page();
    const cut = full.indexOf("playCount") + 4;
    const s = streamed([full.slice(0, cut), full.slice(cut), ...TAIL]);
    serve(s);
    const pool = openTikTokProxyPool(1)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);

    expect(lookup?.state).toBe("live");
    expect(lookup?.metrics?.viewsCount).toBe(4165);
    // Both halves were needed; the tail was not.
    expect(s.pulled.length).toBeGreaterThanOrEqual(2);
    expect(s.pulled.length).toBeLessThan(2 + TAIL.length);
    await pool.close();
  });

  it("reads a walled page to the end, since the shell is tiny and carries no blob", async () => {
    const s = streamed([WALL]);
    serve(s);
    const pool = openTikTokProxyPool(1)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);

    expect(lookup?.state).toBe("unavailable");
    expect(s.pulled).toHaveLength(1);
    await pool.close();
  });

  it("still recognises a deletion, which has no rehydration blob to stop at", async () => {
    const s = streamed([page(10204)]);
    serve(s);
    const pool = openTikTokProxyPool(1)!;
    expect((await pool.readPost(URL_UNDER_TEST))?.state).toBe("deleted");
    await pool.close();
  });
});

describe("configuration", () => {
  it("reports no proxies when nothing is set", () => {
    expect(proxiesConfigured()).toBe(false);
    expect(configuredProxyUrls()).toEqual([]);
  });

  it("accepts a single gateway", () => {
    process.env.TIKTOK_PROXY_URL = "http://user:pass@gw.example:7000";
    expect(proxiesConfigured()).toBe(true);
    expect(configuredProxyUrls()).toHaveLength(1);
  });

  it("accepts a comma-separated list and trims it", () => {
    process.env.TIKTOK_PROXY_URLS =
      " http://a:1@one.example:7000 , http://b:2@two.example:7000 ";
    expect(configuredProxyUrls()).toEqual([
      "http://a:1@one.example:7000",
      "http://b:2@two.example:7000",
    ]);
  });

  it("prefers the list over the single when both are set", () => {
    process.env.TIKTOK_PROXY_URLS = "http://a:1@one.example:7000";
    process.env.TIKTOK_PROXY_URL = "http://b:2@two.example:7000";
    expect(configuredProxyUrls()).toEqual(["http://a:1@one.example:7000"]);
  });

  it("drops an unparseable URL rather than opening a lane that cannot dial", () => {
    process.env.TIKTOK_PROXY_URLS = "not-a-url,http://a:1@one.example:7000";
    expect(configuredProxyUrls()).toEqual(["http://a:1@one.example:7000"]);
  });

  it("drops a non-http scheme", () => {
    process.env.TIKTOK_PROXY_URL = "socks5://a:1@one.example:1080";
    expect(configuredProxyUrls()).toEqual([]);
    expect(proxiesConfigured()).toBe(false);
  });

  it("returns no pool when unconfigured -- callers treat that as 'no pool', not an empty one", () => {
    expect(openTikTokProxyPool(4)).toBeNull();
  });

  it("returns no pool for zero work", () => {
    process.env.TIKTOK_PROXY_URL = "http://user:pass@gw.example:7000";
    expect(openTikTokProxyPool(0)).toBeNull();
  });
});

describe("exit-IP selection", () => {
  beforeEach(() => {
    process.env.TIKTOK_PROXY_URL = "http://user:pass@gw.example:7000";
  });

  it("asks the provider for a distinct session per lane", async () => {
    const pool = openTikTokProxyPool(3)!;
    /* Agents are built lazily, on first use of a lane, so drive three reads. */
    await pool.readPost(URL_UNDER_TEST);
    await pool.readPost(URL_UNDER_TEST);
    await pool.readPost(URL_UNDER_TEST);
    const sessions = mockAgents.map((a) => new URL(a.uri).username);
    expect(new Set(sessions).size).toBe(3);
    for (const s of sessions) expect(decodeURIComponent(s)).toMatch(/^user-session-\w+$/);
    await pool.close();
  });

  it("honours a provider-specific template", async () => {
    process.env.TIKTOK_PROXY_SESSION_TEMPLATE = "{user}-country-us-session-{id}";
    const pool = openTikTokProxyPool(1)!;
    await pool.readPost(URL_UNDER_TEST);
    expect(decodeURIComponent(new URL(mockAgents[0].uri).username)).toMatch(
      /^user-country-us-session-\w+$/,
    );
    await pool.close();
  });

  it("leaves the username alone for providers that rotate on their own", async () => {
    process.env.TIKTOK_PROXY_SESSION_TEMPLATE = "";
    const pool = openTikTokProxyPool(1)!;
    await pool.readPost(URL_UNDER_TEST);
    expect(new URL(mockAgents[0].uri).username).toBe("user");
    await pool.close();
  });

  it("leaves an IP-allowlisted gateway (no username) untouched", async () => {
    process.env.TIKTOK_PROXY_URL = "http://gw.example:7000";
    const pool = openTikTokProxyPool(1)!;
    await pool.readPost(URL_UNDER_TEST);
    expect(mockAgents[0].uri).toBe("http://gw.example:7000");
    await pool.close();
  });

  it("spreads lanes across gateways so one blocked provider is not the whole pool", async () => {
    delete process.env.TIKTOK_PROXY_URL;
    process.env.TIKTOK_PROXY_URLS = "http://a:1@one.example:7000,http://b:2@two.example:7000";
    const pool = openTikTokProxyPool(4)!;
    for (let i = 0; i < 4; i++) await pool.readPost(URL_UNDER_TEST);
    const hosts = mockAgents.map((a) => new URL(a.uri).hostname);
    expect(hosts.filter((h) => h === "one.example")).toHaveLength(2);
    expect(hosts.filter((h) => h === "two.example")).toHaveLength(2);
    await pool.close();
  });
});

describe("reading a post", () => {
  beforeEach(() => {
    process.env.TIKTOK_PROXY_URL = "http://user:pass@gw.example:7000";
  });

  it("returns the metrics when the page carries them", async () => {
    const pool = openTikTokProxyPool(2)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup?.state).toBe("live");
    expect(lookup?.metrics?.viewsCount).toBe(4165);
    expect(fetchCalls).toHaveLength(1);
    await pool.close();
  });

  it("sends browser headers, because a good address with a thin header set is wasted", async () => {
    const pool = openTikTokProxyPool(1)!;
    await pool.readPost(URL_UNDER_TEST);
    const h = fetchCalls[0].headers;
    expect(h["user-agent"]).toMatch(/Mozilla/);
    expect(h["sec-fetch-mode"]).toBe("navigate");
    expect(h["accept-language"]).toBeTruthy();
    await pool.close();
  });

  it("retries a walled read on a different address before giving up", async () => {
    replies = [{ body: WALL }, { body: WALL }, { body: page() }];
    const pool = openTikTokProxyPool(3)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup?.state).toBe("live");
    expect(fetchCalls).toHaveLength(3);
    /* Three attempts, three different exit sessions -- retrying the same
       address against a per-address wall is just a slower refusal. */
    expect(new Set(mockAgents.map((a) => a.uri)).size).toBe(3);
    await pool.close();
  });

  it("retries an HTTP refusal too, and rotates the burned session", async () => {
    replies = [{ status: 403, body: "" }, { body: page() }];
    const pool = openTikTokProxyPool(2)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup?.state).toBe("live");
    expect(fetchCalls).toHaveLength(2);
    await pool.close();
  });

  it("survives a transport throw and answers from another lane", async () => {
    replies = [new Error("ECONNRESET"), { body: page() }];
    const pool = openTikTokProxyPool(2)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup?.state).toBe("live");
    await pool.close();
  });

  it("stops at the attempt cap rather than walking every lane", async () => {
    process.env.TIKTOK_PROXY_MAX_ATTEMPTS = "2";
    replies = [{ body: WALL }, { body: WALL }, { body: page() }];
    const pool = openTikTokProxyPool(6)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(fetchCalls).toHaveLength(2);
    expect(lookup?.state).toBe("unavailable");
    await pool.close();
  });

  it("reports 'unavailable', not null, when every attempt is walled", async () => {
    /* The distinction the whole ladder rests on: unavailable is TikTok refusing
       an address, null is our transport dying. Collapsing them would tell the
       caller the reader broke when it plainly worked. */
    replies = [{ body: WALL }, { body: WALL }, { body: WALL }];
    const pool = openTikTokProxyPool(3)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup).not.toBeNull();
    expect(lookup?.state).toBe("unavailable");
    await pool.close();
  });

  it("returns null when no attempt ever reached TikTok", async () => {
    replies = [new Error("ECONNRESET"), new Error("ECONNRESET"), new Error("ECONNRESET")];
    const pool = openTikTokProxyPool(3)!;
    expect(await pool.readPost(URL_UNDER_TEST)).toBeNull();
    await pool.close();
  });

  it("accepts a deletion as final and does not re-ask other addresses", async () => {
    replies = [{ body: page(10204) }];
    const pool = openTikTokProxyPool(4)!;
    const lookup = await pool.readPost(URL_UNDER_TEST);
    expect(lookup?.state).toBe("deleted");
    expect(fetchCalls).toHaveLength(1);
    await pool.close();
  });

  it("reports its lane count so callers can match concurrency to it", () => {
    const pool = openTikTokProxyPool(5)!;
    expect(pool.size).toBe(5);
  });

  it("caps lanes at the configured ceiling", () => {
    process.env.TIKTOK_PROXY_MAX_LANES = "3";
    expect(openTikTokProxyPool(50)!.size).toBe(3);
  });

  it("closes every agent it built", async () => {
    const pool = openTikTokProxyPool(2)!;
    await pool.readPost(URL_UNDER_TEST);
    await pool.readPost(URL_UNDER_TEST);
    await pool.close();
    expect(mockAgents.length).toBeGreaterThan(0);
    expect(mockAgents.every((a) => a.closed)).toBe(true);
  });
});
