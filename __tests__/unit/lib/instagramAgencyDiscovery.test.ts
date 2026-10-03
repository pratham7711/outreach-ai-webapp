/**
 * @jest-environment node
 *
 * Which token a Business Discovery read is asked with once an agency can
 * connect its own Instagram account (research/meta.md §3.4). Driven through
 * the real Graph client with fetch faked: an org with a row reads through its
 * own token and IG user id; an org without one, and a read with no org, reads
 * through the operator token exactly as before.
 */
import { randomBytes } from "crypto";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

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
  ...jest.requireActual("@/lib/platforms/instagramBusinessToken"),
  getInstagramBusinessToken: jest.fn(async () => "fake-operator-token"),
}));
jest.mock("@/lib/platforms/instagramEmbed", () => ({
  fetchInstagramEmbedPost: jest.fn(async () => null),
}));

const mockFindUnique = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

import { readCreatorProfile, resetInstagramReaderState } from "@/lib/platforms/creatorProfile";
import { fetchInstagramMetrics } from "@/lib/platforms/fetchPostMetrics";
import {
  TRACKER_SWEEP_STOP_PERCENT,
  backgroundReadsDeferred,
  readWithDiscoveryToken,
  resetDiscoveryTokenState,
} from "@/lib/platforms/instagramDiscoveryTokens";
import {
  agencyProvider,
  clearAgencyCredentialCache,
  encodeAgencyMeta,
  loadAgencyDiscoveryCredentials,
} from "@/lib/platforms/instagramAgencyCredential";
import { encrypt } from "@/lib/crypto/encrypt";

const OPERATOR = "fake-operator-token";
const ORG_TOKEN = "fake-agency-token";
const ORG = "org-agency";
const OTHER_ORG = "org-without-account";
const ORG_IG_ID = "17840000000000001";
const HANDLE = "fake.creator.handle";
const POST = "https://www.instagram.com/reel/FAKESHORT1/";

let clock = Date.parse("2026-10-04T10:00:00Z");
const now = () => clock;

function agencyRow(orgId: string, overrides: Record<string, unknown> = {}) {
  return {
    provider: agencyProvider(orgId),
    accessToken: encrypt(ORG_TOKEN, agencyProvider(orgId)),
    expiresAt: new Date(clock + 50 * 86_400_000),
    refreshedAt: new Date(clock - 86_400_000),
    lastAttemptAt: null,
    lastError: null,
    source: encodeAgencyMeta({
      via: "oauth",
      igUserId: ORG_IG_ID,
      username: "agency.account",
      pageId: "page-1",
      fbUserId: "fb-1",
    }),
    createdAt: new Date(clock - 86_400_000),
    ...overrides,
  };
}

type Behaviour = "ok" | "limited" | "rejected";
type Call = { token: string | null; path: string };

const discoveryBody = {
  business_discovery: {
    followers_count: 5000,
    media_count: 12,
    media: {
      data: [
        {
          id: "m1",
          permalink: POST,
          view_count: 900,
          like_count: 40,
          comments_count: 3,
          timestamp: "2026-09-01T00:00:00+0000",
        },
      ],
    },
  },
};

const headersOf = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status < 400,
  status,
  json: async () => body,
  headers: headersOf(headers),
});

function fakeGraph(behaviour: Record<string, Behaviour>, usage: Record<string, string> = {}) {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (input: string) => {
    const u = new URL(input);
    if (u.hostname !== "graph.facebook.com") return reply(500, {});
    const token = u.searchParams.get("access_token");
    calls.push({ token, path: u.pathname });
    const b = behaviour[token ?? ""] ?? "rejected";
    if (b === "limited") return reply(400, { error: { code: 4, message: "Application request limit reached" } });
    if (b === "rejected") return reply(400, { error: { code: 190, message: "Invalid OAuth access token" } });
    if (u.pathname.endsWith("/me/accounts")) {
      return reply(200, { data: [{ instagram_business_account: { id: "ig-operator" } }] });
    }
    return reply(200, discoveryBody, usage);
  }) as unknown as typeof fetch;
  return calls;
}

const realFetch = global.fetch;

beforeEach(() => {
  resetDiscoveryTokenState();
  resetInstagramReaderState();
  clearAgencyCredentialCache();
  logged.length = 0;
  clock = Date.parse("2026-10-04T10:00:00Z");
  jest.spyOn(Date, "now").mockImplementation(now);
  mockFindUnique.mockReset().mockImplementation(async ({ where }: { where: { provider: string } }) =>
    where.provider === agencyProvider(ORG) ? agencyRow(ORG) : null,
  );
  mockUpdateMany.mockReset().mockResolvedValue({ count: 1 });
});
afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = realFetch;
});

const tokensAsked = (calls: Call[]) => [...new Set(calls.map((c) => c.token))];

describe("token selection", () => {
  it("reads an org with its own account through that account's token and IG user id", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });

    expect(out).toMatchObject({ ok: true, profile: { followersCount: 5000 }, via: { username: "agency.account" } });
    expect(tokensAsked(calls)).toEqual([ORG_TOKEN]);
    // GET /{agency_ig_user_id}?fields=business_discovery... -- and no me/accounts lookup first.
    expect(calls.map((c) => c.path)).toEqual([`/v26.0/${ORG_IG_ID}`]);
  });

  it("reads an org with no account of its own through the operator token, unchanged", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: OTHER_ORG });

    expect(out).toMatchObject({ ok: true, profile: { followersCount: 5000 } });
    expect(out).not.toHaveProperty("via");
    expect(tokensAsked(calls)).toEqual([OPERATOR]);
  });

  it("never looks for an org account when the read names no org", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok" });

    const out = await readWithDiscoveryToken(async (cred) => cred);

    expect(out).toMatchObject({ ok: true, slot: "A", value: { token: OPERATOR } });
    expect(mockFindUnique).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("treats an expired org row as no account", async () => {
    mockFindUnique.mockResolvedValue(agencyRow(ORG, { expiresAt: new Date(clock - 1000) }));
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" });

    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });

    expect(tokensAsked(calls)).toEqual([OPERATOR]);
  });

  it("asks the database once per org per minute, absences included", async () => {
    fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" });

    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: OTHER_ORG });
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: OTHER_ORG });
    expect(mockFindUnique).toHaveBeenCalledTimes(2);

    clock += 61_000;
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });
    expect(mockFindUnique).toHaveBeenCalledTimes(3);
  });

  it("reads a post for that org through its own account", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" });

    const m = await fetchInstagramMetrics(POST, undefined, HANDLE, undefined, ORG);

    expect(m).toMatchObject({ viewsCount: 900, likesCount: 40 });
    expect(tokensAsked(calls)).toEqual([ORG_TOKEN]);
  });
});

describe("when the org's own account cannot answer", () => {
  it("files a limit on the org's account as rate-limited and leaves the operator token alone", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "limited" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });

    expect(out).toMatchObject({ ok: false, reason: "rate-limited" });
    expect(tokensAsked(calls)).toEqual([ORG_TOKEN]);
  });

  it("falls back to the operator token when Meta rejects the org's token, and stamps the row expired", async () => {
    const calls = fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "rejected" });

    const out = await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });

    expect(out).toMatchObject({ ok: true, profile: { followersCount: 5000 } });
    expect(out).not.toHaveProperty("via");
    expect(tokensAsked(calls)).toEqual([ORG_TOKEN, OPERATOR]);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { provider: agencyProvider(ORG) },
      data: expect.objectContaining({ expiresAt: new Date(clock), lastError: expect.stringMatching(/refused/) }),
    });

    // The next read does not try the dead token again.
    calls.length = 0;
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });
    expect(tokensAsked(calls)).toEqual([OPERATOR]);
  });

  it("defers a background read on the org's own usage, not the operator's", async () => {
    fakeGraph({ [OPERATOR]: "ok", [ORG_TOKEN]: "ok" }, { "x-app-usage": JSON.stringify({ call_count: 70 }) });
    await readCreatorProfile("INSTAGRAM", HANDLE, { orgId: ORG });
    await loadAgencyDiscoveryCredentials([ORG, OTHER_ORG]);

    expect(backgroundReadsDeferred(TRACKER_SWEEP_STOP_PERCENT, clock, {}, ORG)).toBe(true);
    expect(backgroundReadsDeferred(TRACKER_SWEEP_STOP_PERCENT, clock, {}, OTHER_ORG)).toBe(false);
    expect(backgroundReadsDeferred(TRACKER_SWEEP_STOP_PERCENT, clock, {})).toBe(false);
  });
});
