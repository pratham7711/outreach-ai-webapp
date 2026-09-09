import { ProxyAgent } from "undici";
import { createLogger } from "@/lib/observability/logger";
import {
  createRateGate,
  readTikTokPostHtml,
  TIKTOK_DIRECT_UA,
  type TikTokPostLookup,
} from "./fetchPostMetrics";
import type { SandboxPostFetcher } from "./tiktokPostSandbox";

/**
 * Read TikTok through residential/mobile proxies, from the function itself.
 *
 * WHY THIS EXISTS, and why it sits above the sandbox pool in the ladder.
 *
 * The sandbox pool solved the right problem with the only material it had. Its
 * premise -- measured, and still true -- is that TikTok refuses on identity
 * rather than on volume, so throughput comes from holding more egress
 * identities. But every identity it can hold is an AWS datacenter address, and
 * a datacenter address is precisely the thing TikTok's WAF is built to
 * distrust. Widening from one datacenter IP to eight raises the pass rate; it
 * cannot raise it past what a datacenter IP is allowed to have. That ceiling is
 * what a 58-post refresh reporting 27 measured / 15 backing-off / 13 refused
 * was hitting, and no amount of extra lanes moves it.
 *
 * A residential or mobile proxy is a different kind of address, not more of the
 * same kind. It is the one lever that changes the pass rate itself rather than
 * the number of attempts at the old one.
 *
 * Three secondary wins, none of them the reason but all of them real:
 *
 *   - It is CHEAPER. A sandbox lane bills for its whole lifetime; a proxied
 *     request bills for bytes. The sandbox pool exists only to obtain an IP, and
 *     a proxy obtains a better one without booting a machine to hold it.
 *   - It is FASTER. No sandbox boot latency before the first read, which is the
 *     cost the lane-sizing arithmetic explicitly does not model and where small
 *     refreshes lose to CreatorCore today.
 *   - It has no region ceiling. Sandboxes exist in four regions; a proxy pool
 *     has as many exit identities as the plan sells.
 *
 * The transport is the ONLY thing that differs from the other two egresses.
 * readTikTokPostHtml is deliberately free of transport opinion, and parsing the
 * `__UNIVERSAL_DATA_FOR_REHYDRATION__` blob is still the correct 2026 technique
 * -- so this module owns addresses, pacing and headers, and nothing else.
 *
 * INERT UNTIL CONFIGURED. With no proxy env set, openTikTokProxyPool returns
 * null and the ladder behaves exactly as it does today. Nothing here changes
 * behaviour on a deployment that has not bought proxies.
 */

const log = createLogger({ context: { platform: "TIKTOK", via: "proxy-pool" } });

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The proxy endpoints available, in provider gateway form.
 *
 * `TIKTOK_PROXY_URLS` takes a comma-separated list for a multi-provider setup;
 * `TIKTOK_PROXY_URL` is the ordinary single-gateway case. Both are accepted so
 * a deployment can start with one and grow without a code change -- spreading
 * across two providers is the cheapest insurance against one of them being
 * blocked wholesale, which is the failure the sandbox pool's four regions were
 * also trying to hedge.
 */
export function configuredProxyUrls(): string[] {
  const many = (process.env.TIKTOK_PROXY_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const one = (process.env.TIKTOK_PROXY_URL ?? "").trim();
  const all = many.length ? many : one ? [one] : [];
  return all.filter((u) => {
    try {
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      log.error("ignoring an unparseable proxy URL", { url: u.slice(0, 24) + "..." });
      return false;
    }
  });
}

export function proxiesConfigured(): boolean {
  return configuredProxyUrls().length > 0;
}

/**
 * Ask the provider for a specific exit IP, by rewriting the username.
 *
 * Every major residential provider selects a sticky session through the proxy
 * USERNAME rather than through a header or a distinct host -- Bright Data,
 * Oxylabs, Decodo/Smartproxy and IPRoyal all use some spelling of
 * `user-session-<id>`. The exact spelling differs per provider, so it is a
 * template rather than a hardcoded string: `TIKTOK_PROXY_SESSION_TEMPLATE`
 * defaults to `{user}-session-{id}` and can be set to whatever the provider
 * documents (e.g. `{user}-country-us-session-{id}`).
 *
 * Set it to an empty string for providers that rotate on every request without
 * being asked -- then the username is left exactly as configured.
 */
function withSession(proxyUrl: string, sessionId: string): string {
  const template = process.env.TIKTOK_PROXY_SESSION_TEMPLATE ?? "{user}-session-{id}";
  if (!template) return proxyUrl;

  const u = new URL(proxyUrl);
  if (!u.username) return proxyUrl; // nothing to rewrite; provider is IP-allowlisted
  const base = decodeURIComponent(u.username);
  /* Idempotent: re-templating an already-templated username would produce
     `user-session-a-session-b` and select neither. */
  if (base.includes("-session-")) return proxyUrl;
  u.username = encodeURIComponent(
    template.replace("{user}", base).replace("{id}", sessionId),
  );
  return u.toString();
}

/** A short, unguessable session id. Providers key an exit IP to this string. */
function newSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type ProxyLane = {
  label: string;
  /** The gateway this lane dials, before the session rewrite. */
  gateway: string;
  sessionId: string;
  agent: ProxyAgent | null;
  gate: ReturnType<typeof createRateGate>;
  generation: number;
};

/**
 * Headers that make the request look like the browser TikTok expects.
 *
 * Scrapfly's 2026 guidance and our own measurements agree that a bare request
 * is flagged regardless of the address, so a good IP with a thin header set
 * wastes the good IP. These mirror what the sandbox curl already sends, plus
 * the sec-fetch set a real navigation carries -- curl cannot send those
 * convincingly, so this transport can actually do slightly better than the one
 * it is replacing.
 */
function browserHeaders(): Record<string, string> {
  return {
    "user-agent": TIKTOK_DIRECT_UA,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };
}

/** Where the numbers live. Everything after this tag closes is page we do not read. */
const REHYDRATION_MARKER = "__UNIVERSAL_DATA_FOR_REHYDRATION__";

/**
 * Stop reading the page the moment the numbers have arrived.
 *
 * A TikTok video page is ~390KB and the rehydration blob sits near the top of
 * it; everything after the blob's closing tag is markup, inlined CSS and the
 * player bundle, none of which any reader here has ever looked at. `res.text()`
 * downloads all of it anyway.
 *
 * This matters twice over, and the second one is the reason it is worth the
 * code. Time: bytes we never wait for are latency we never pay, on every post
 * in a 200-post refresh. Money: a proxy bills by the GIGABYTE, so the tail of
 * each page is a line on an invoice for data that goes straight in the bin --
 * the single biggest lever on what this transport costs to run.
 *
 * Falls through to reading everything when the blob never appears, because that
 * is the WAF shell, which is ~1.4KB and costs nothing to read whole. Capped
 * regardless, so a pathological page cannot stream forever.
 */
async function readUntilRehydration(res: Response, capBytes = 1_500_000): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text(); // no stream to walk; take it whole

  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });

      /* Only once the blob is CLOSED. Breaking on the marker alone would hand
         the parser a truncated JSON object, which fails as "unparseable" and
         reads identically to a wall -- a self-inflicted refusal. */
      const start = html.indexOf(REHYDRATION_MARKER);
      if (start !== -1 && html.indexOf("</script>", start) !== -1) break;
      if (bytes >= capBytes) break;
    }
  } finally {
    /* Releases the socket back to the agent instead of leaving the rest of the
       page draining in the background, which would spend the bandwidth we just
       went to the trouble of not spending. */
    reader.cancel().catch(() => {});
  }
  return html + decoder.decode();
}

/**
 * A pool of proxied egress identities, shaped exactly like the sandbox pool.
 *
 * Same interface on purpose: the ladder in fetchTikTokMetrics already knows how
 * to drive a SandboxPostFetcher, and "which kind of address answered" is not a
 * distinction any caller should have to make. It lets the proxy pool be tried
 * first and the sandbox pool remain the fallback with no call-site churn.
 *
 * Returns null when nothing is configured, so callers can treat "no proxies" as
 * "no pool" rather than as an empty pool that fails every read.
 */
export function openTikTokProxyPool(size: number): SandboxPostFetcher | null {
  const gateways = configuredProxyUrls();
  if (gateways.length === 0 || size <= 0) return null;

  const laneCount = Math.max(1, Math.min(size, envInt("TIKTOK_PROXY_MAX_LANES", 16)));
  const maxAttempts = envInt("TIKTOK_PROXY_MAX_ATTEMPTS", 3);

  /* Pacing per identity, not across the fleet -- the same reasoning the sandbox
     pool documents. A residential IP tolerates more than a datacenter one, so
     the default gap is shorter; it is still a gap, because a residential
     address behaving like a crawler stops looking residential. */
  const newGate = () =>
    createRateGate({
      minGapMs: envInt("TIKTOK_PROXY_MIN_GAP_MS", 700),
      jitterMs: envInt("TIKTOK_PROXY_JITTER_MS", 400),
      breakerThreshold: envInt("TIKTOK_PROXY_BREAKER_THRESHOLD", 5),
      breakerCooldownMs: envInt("TIKTOK_PROXY_BREAKER_COOLDOWN_MS", 5 * 60 * 1000),
      challengeThreshold: envInt("TIKTOK_PROXY_CHALLENGE_THRESHOLD", 8),
      challengeCooldownMs: envInt("TIKTOK_PROXY_CHALLENGE_COOLDOWN_MS", 2 * 60 * 1000),
    });

  const lanes: ProxyLane[] = Array.from({ length: laneCount }, (_, i) => ({
    label: `proxy-${i}`,
    /* Round-robin across gateways so a two-provider setup splits the load
       rather than exhausting the first one. */
    gateway: gateways[i % gateways.length],
    sessionId: newSessionId(),
    agent: null,
    gate: newGate(),
    generation: 1,
  }));

  const timeoutMs = envInt("TIKTOK_PROXY_TIMEOUT_MS", 20_000);

  const agentFor = (lane: ProxyLane): ProxyAgent => {
    if (!lane.agent) {
      lane.agent = new ProxyAgent({
        uri: withSession(lane.gateway, lane.sessionId),
        connectTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headersTimeout: timeoutMs,
      });
    }
    return lane.agent;
  };

  /**
   * Re-address a lane: a new session id is a new exit IP.
   *
   * The sandbox pool has to boot a whole machine to do this and budgets the
   * churn accordingly. Here it costs one object allocation, which is why there
   * is no replacement budget: rotating a burned residential session is the
   * normal, cheap response to a wall, not an escalation.
   */
  const rotate = (lane: ProxyLane) => {
    const spent = lane.agent;
    lane.agent = null;
    if (spent) spent.close().catch(() => {});
    lane.generation += 1;
    lane.sessionId = newSessionId();
    lane.label = `proxy-${lane.label.split("#")[0].replace("proxy-", "")}#${lane.generation}`;
    lane.gate = newGate();
  };

  let cursor = 0;

  const pick = (exclude: Set<string>): ProxyLane | null => {
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (lane.gate.isOpen()) continue;
      if (exclude.has(lane.label)) continue;
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }
    /* Everything is latched or already spent on this post. Rotating is a real
       answer rather than a wait -- a fresh session is a fresh address, and it
       costs nothing, so unlike the sandbox pool there is no budget to run out
       of and no reason to report the post unreadable while sessions remain. */
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (!lane.gate.isOpen() && !exclude.has(lane.label)) continue;
      rotate(lane);
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }
    return null;
  };

  const attemptOn = async (lane: ProxyLane, url: string): Promise<TikTokPostLookup | null> => {
    if (!(await lane.gate.acquire())) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: browserHeaders(),
        redirect: "follow",
        signal: controller.signal,
        // @ts-expect-error -- undici's dispatcher option is not in the DOM fetch types.
        dispatcher: agentFor(lane),
      });

      if (!res.ok) {
        /* 403/429/5xx is the channel refusing us, which is what recordBlocked
           means. Rotate immediately: this session's IP is spent, and the next
           post should not have to discover that for itself. */
        lane.gate.recordBlocked();
        log.warn("proxy read refused", { lane: lane.label, status: res.status, url });
        rotate(lane);
        return null;
      }

      const html = await readUntilRehydration(res);
      if (!html) {
        lane.gate.recordBlocked();
        rotate(lane);
        return null;
      }

      const lookup = readTikTokPostHtml(html);
      /* "Answered but unparseable" is the WAF shell reaching this address too.
         A deleted post is a real answer and must not count against it. */
      if (lookup.state === "unavailable") {
        lane.gate.recordChallenged();
        rotate(lane);
      } else {
        lane.gate.recordSuccess();
      }
      return lookup;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      lane.gate.recordBlocked();
      log.warn("proxy read failed", { lane: lane.label, url, error: message });
      rotate(lane);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    get size() {
      return lanes.length;
    },

    async readPost(url: string) {
      const tried = new Set<string>();
      let walled: TikTokPostLookup | null = null;
      let asked = 0;

      while (asked < Math.max(1, maxAttempts)) {
        const lane = pick(tried);
        if (!lane) break;
        tried.add(lane.label);

        const lookup = await attemptOn(lane, url);
        asked++;
        if (lookup === null) continue;
        /* Live or deleted is TikTok actually answering about this post. Both
           are final -- re-asking a deleted post from five addresses gets five
           identical answers and costs five paced slots. */
        if (lookup.state !== "unavailable") return lookup;
        walled = lookup;
      }
      /* Walled everywhere we tried. Null would claim the transport broke; the
           caller still gets its turn at the sandbox and the direct egress. */
      return walled;
    },

    async close() {
      await Promise.all(
        lanes.map(async (lane) => {
          const agent = lane.agent;
          lane.agent = null;
          if (agent) await agent.close().catch(() => {});
        }),
      );
    },
  };
}
