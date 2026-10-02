/**
 * @jest-environment node
 *
 * Instagram standby token B (plan §13 B), driven end to end through the real
 * Graph client with only fetch mocked: A answers until it reports a limit, B
 * takes the rest of that window, B unset is today's behaviour, and both
 * limited is "rate-limited" -- never a 0 and never a personal account.
 */
const logged: { level: string; message: string; facts?: unknown }[] = [];
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({
    error: (message: string, facts?: unknown) => logged.push({ level: "error", message, facts }),
    warn: (message: string, facts?: unknown) => logged.push({ level: "warn", message, facts }),
    info: (message: string, facts?: unknown) => logged.push({ level: "info", message, facts }),
    debug: jest.fn(),
  }),
}));
jest.mock("@/lib/platforms/instagramBusinessToken", () => ({
  getInstagramBusinessToken: jest.fn(async () => "fake-token-a"),
}));
jest.mock("@/lib/platforms/instagramEmbed", () => ({
  fetchInstagramEmbedPost: jest.fn(async () => null),
}));

import { readCreatorProfile } from "@/lib/platforms/creatorProfile";
import { fetchInstagramMetrics } from "@/lib/platforms/fetchPostMetrics";
import { getInstagramBusinessToken } from "@/lib/platforms/instagramBusinessToken";
import {
  DEFAULT_LIMIT_WINDOW_MS,
  TOKEN_B_ENV,
  TOKEN_B_USER_ID_ENV,
  parseGraphUsage,
  readWithDiscoveryToken,
  resetDiscoveryTokenState,
} from "@/lib/platforms/instagramDiscoveryTokens";

const HANDLE = "fake.creator.handle";
const POST = "https://www.instagram.com/reel/FAKESHORT1/";
const TOKEN_A = "fake-token-a";
const TOKEN_B = "fake-token-b";

type Behaviour = "ok" | "limited" | "rejected";
type Call = { token: string | null; edge: "accounts" | "discovery" | "other" };

const headersOf = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { ok: status < 400, status, json: async () => body, headers: headersOf(headers) };
}

const discoveryBody = {
  business_discovery: {
    followers_count: 5000,
    media_count: 12,
    media: {
      data: [
        {
          id: "m1",
          permalink: "https://www.instagram.com/reel/FAKESHORT1/",
          view_count: 900,
          like_count: 40,
          comments_count: 3,
          timestamp: "2026-09-01T00:00:00+0000",
        },
      ],
    },
  },
};

/** A fake Graph: each token answers as `behaviour` says; anything else 500s. */
function fakeGraph(behaviour: Record<string, Behaviour>, usage: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fn = jest.fn(async (input: string) => {
    const u = new URL(input);
    if (u.hostname !== "graph.facebook.com") {
      calls.push({ token: null, edge: "other" });
      return reply(500, {});
    }
    const token = u.searchParams.get("access_token");
    const edge = u.pathname.endsWith("/me/accounts") ? "accounts" : "discovery";
    calls.push({ token, edge });
    const b = behaviour[token ?? ""] ?? "rejected";
    if (b === "limited") return reply(400, { error: { code: 4, message: "Application request limit reached" } });
    if (b === "rejected") return reply(400, { error: { code: 190, message: "Invalid OAuth access token" } });
    if (edge === "accounts") return reply(200, { data: [{ instagram_business_account: { id: "ig-fake-a" } }] });
    return reply(200, discoveryBody, token ? usage : {});
  });
  global.fetch = fn as unknown as typeof fetch;
  return calls;
}

const realFetch = global.fetch;
let clock = Date.parse("2026-10-02T10:00:00Z");
const now = () => clock;

beforeEach(() => {
  resetDiscoveryTokenState();
  logged.length = 0;
  clock = Date.parse("2026-10-02T10:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(now);
  (getInstagramBusinessToken as jest.Mock).mockResolvedValue(TOKEN_A);
  delete process.env[TOKEN_B_ENV];
  delete process.env[TOKEN_B_USER_ID_ENV];
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = realFetch;
  delete process.env[TOKEN_B_ENV];
  delete process.env[TOKEN_B_USER_ID_ENV];
});

const tokensAsked = (calls: Call[]) => [...new Set(calls.filter((c) => c.token).map((c) => c.token))];

describe("A answers", () => {
  it("reads with A and never touches B", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    const calls = fakeGraph({ [TOKEN_A]: "ok", [TOKEN_B]: "ok" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE);

    expect(out).toMatchObject({ ok: true, profile: { followersCount: 5000 } });
    expect(tokensAsked(calls)).toEqual([TOKEN_A]);
  });
});

describe("A rate-limited, B configured", () => {
  it("retries the refused read on B, and keeps B for the rest of the window", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    process.env[TOKEN_B_USER_ID_ENV] = "ig-fake-b";
    const calls = fakeGraph({ [TOKEN_A]: "limited", [TOKEN_B]: "ok" });

    const first = await readCreatorProfile("INSTAGRAM", HANDLE);
    expect(first).toMatchObject({ ok: true, profile: { followersCount: 5000 } });
    expect(tokensAsked(calls)).toEqual([TOKEN_A, TOKEN_B]);
    /* B's IG user id is configured, so B never spends a call on me/accounts. */
    expect(calls.filter((c) => c.token === TOKEN_B).map((c) => c.edge)).toEqual(["discovery"]);

    calls.length = 0;
    clock += 30 * 60_000;
    await readCreatorProfile("INSTAGRAM", HANDLE);
    expect(tokensAsked(calls)).toEqual([TOKEN_B]);

    calls.length = 0;
    clock += DEFAULT_LIMIT_WINDOW_MS;
    fakeGraph({ [TOKEN_A]: "ok", [TOKEN_B]: "ok" });
    const after = await readWithDiscoveryToken(async (cred) => cred.slot, { now });
    expect(after).toEqual({ ok: true, value: "A", slot: "A" });
  });

  it("switches before the refusal when A's usage header reaches 95%", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    const calls = fakeGraph(
      { [TOKEN_A]: "ok", [TOKEN_B]: "ok" },
      { "x-app-usage": JSON.stringify({ call_count: 96, total_cputime: 10, total_time: 12 }) },
    );

    const first = await readCreatorProfile("INSTAGRAM", HANDLE);
    expect(first).toMatchObject({ ok: true });
    expect(tokensAsked(calls)).toEqual([TOKEN_A]);

    calls.length = 0;
    await readCreatorProfile("INSTAGRAM", HANDLE);
    expect(tokensAsked(calls)).toEqual([TOKEN_B]);
  });

  it("takes Meta's own regain time as the window when it states one", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    fakeGraph(
      { [TOKEN_A]: "ok", [TOKEN_B]: "ok" },
      {
        "x-business-use-case-usage": JSON.stringify({
          "1234": [{ type: "instagram", call_count: 99, total_cputime: 5, total_time: 5, estimated_time_to_regain_access: 7 }],
        }),
      },
    );
    await readCreatorProfile("INSTAGRAM", HANDLE);

    clock += 6 * 60_000;
    expect(await readWithDiscoveryToken(async (c) => c.slot, { now })).toMatchObject({ slot: "B" });
    clock += 2 * 60_000;
    expect(await readWithDiscoveryToken(async (c) => c.slot, { now })).toMatchObject({ slot: "A" });
  });
});

describe("B unset: today's behaviour", () => {
  it("asks A, files the throttle as rate-limited, and asks A again next time", async () => {
    const calls = fakeGraph({ [TOKEN_A]: "limited" });

    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(tokensAsked(calls)).toEqual([TOKEN_A]);

    calls.length = 0;
    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(tokensAsked(calls)).toEqual([TOKEN_A]);
  });

  it("reads with A alone when A answers", async () => {
    const calls = fakeGraph({ [TOKEN_A]: "ok" });
    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toMatchObject({ ok: true, profile: { followersCount: 5000 } });
    expect(tokensAsked(calls)).toEqual([TOKEN_A]);
  });

  it("says no-credentials when neither token exists", async () => {
    (getInstagramBusinessToken as jest.Mock).mockResolvedValue(undefined);
    fakeGraph({});
    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toEqual({ ok: false, reason: "no-credentials" });
  });
});

describe("both limited", () => {
  it("answers rate-limited, with no follower figure at all", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    const calls = fakeGraph({ [TOKEN_A]: "limited", [TOKEN_B]: "limited" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE);
    expect(out).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(out).not.toHaveProperty("profile");
    expect(tokensAsked(calls)).toEqual([TOKEN_A, TOKEN_B]);

    /* Both are now known to be limited: the next read in the window asks
       neither, and is still rate-limited rather than anything else. */
    calls.length = 0;
    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(calls.filter((c) => c.token)).toEqual([]);
  });

  it("leaves a post's counters absent, never 0", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    fakeGraph({ [TOKEN_A]: "limited", [TOKEN_B]: "limited" });

    const m = await fetchInstagramMetrics(POST, undefined, HANDLE);
    expect(m.viewsCount).toBeUndefined();
    expect(m.likesCount).toBeUndefined();
    expect(m.commentsCount).toBeUndefined();
    expect(m.fetchReason).toBeDefined();
  });

  it("files a rejected B as the spare's problem, not A's, while A is limited", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    fakeGraph({ [TOKEN_A]: "limited", [TOKEN_B]: "rejected" });

    expect(await readCreatorProfile("INSTAGRAM", HANDLE)).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(logged.some((l) => l.level === "error" && l.message.includes(TOKEN_B_ENV))).toBe(true);
  });
});

describe("the post path", () => {
  it("measures the post through B when A is limited", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    fakeGraph({ [TOKEN_A]: "limited", [TOKEN_B]: "ok" });

    const m = await fetchInstagramMetrics(POST, undefined, HANDLE);
    expect(m).toMatchObject({ viewsCount: 900, likesCount: 40, commentsCount: 3 });
  });
});

describe("usage logging", () => {
  it("logs Meta's numbers, and never a handle, a token or an account id", async () => {
    process.env[TOKEN_B_ENV] = TOKEN_B;
    fakeGraph(
      { [TOKEN_A]: "ok" },
      {
        "x-app-usage": JSON.stringify({ call_count: 41, total_cputime: 7, total_time: 9 }),
        "x-business-use-case-usage": JSON.stringify({ "17841400000000000": [{ call_count: 12, total_cputime: 3, total_time: 4 }] }),
      },
    );
    await readCreatorProfile("INSTAGRAM", HANDLE);

    const usage = logged.find((l) => l.message === "Graph usage");
    expect(usage?.facts).toMatchObject({ slot: "A", appCallPct: 41, appCpuPct: 7, appTimePct: 9, bucPct: 12 });
    const all = JSON.stringify(logged);
    for (const secret of [HANDLE, TOKEN_A, TOKEN_B, "17841400000000000", "ig-fake-a"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("parseGraphUsage", () => {
  it("reads both headers and takes the highest figure", () => {
    const u = parseGraphUsage(
      headersOf({
        "x-app-usage": JSON.stringify({ call_count: 20, total_cputime: 30, total_time: 10 }),
        "x-business-use-case-usage": JSON.stringify({
          a: [{ call_count: 50, total_cputime: 1, total_time: 1, estimated_time_to_regain_access: 0 }],
          b: [{ call_count: 5, total_cputime: 70, total_time: 1, estimated_time_to_regain_access: 12 }],
        }),
      }),
    );
    expect(u).toEqual({ app: { calls: 20, cpu: 30, time: 10 }, bucPercent: 70, regainMinutes: 12, maxPercent: 70 });
  });

  it("is null when neither header is there or readable", () => {
    expect(parseGraphUsage(headersOf({}))).toBeNull();
    expect(parseGraphUsage(headersOf({ "x-app-usage": "not json" }))).toBeNull();
  });
});
