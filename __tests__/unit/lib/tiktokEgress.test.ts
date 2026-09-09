/**
 * Which egress opens, and -- the part that shows up on an invoice -- whether a
 * sandbox boots at all.
 *
 * A sandbox bills for its whole lifetime; a proxy session bills for bytes. So
 * "the proxy worked and we booted a sandbox anyway" is not a cosmetic defect,
 * it is the standing-cost bug class that already cost this project $13.49/mo in
 * orphaned snapshots. These tests pin the boot decision rather than trusting the
 * comment that describes it.
 */

const proxyPool = {
  readPost: jest.fn(),
  close: jest.fn(async () => {}),
  size: 4,
};
const sandboxPool = {
  readPost: jest.fn(),
  close: jest.fn(async () => {}),
  size: 2,
};
const oneLaneSandbox = {
  readPost: jest.fn(),
  close: jest.fn(async () => {}),
  size: 1,
};

let mockProxiesConfigured = false;
let mockProxyOpens = true;
const openProxy = jest.fn(() => (mockProxyOpens ? proxyPool : null));
const openPool = jest.fn(() => sandboxPool);
const openOne = jest.fn(() => oneLaneSandbox);

jest.mock("@/lib/platforms/tiktokProxy", () => ({
  proxiesConfigured: () => mockProxiesConfigured,
  openTikTokProxyPool: (...args: unknown[]) => openProxy(...(args as [])),
}));

jest.mock("@/lib/platforms/tiktokPostSandbox", () => ({
  laneCountFor: (n: number) => (n > 0 ? Math.min(8, Math.ceil(n / 8)) : 0),
  openSandboxPostPool: (...args: unknown[]) => openPool(...(args as [])),
  openSandboxPostFetcher: () => openOne(),
}));

import {
  openTikTokPostFetcher,
  openTikTokPostFetcherForOne,
  proxyLaneCountFor,
} from "@/lib/platforms/tiktokEgress";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7675846963421646098";
const live = { state: "live" as const, statusCode: 0, reason: null, metrics: { caption: null, thumbnailUrl: null, postedAt: null, viewsCount: 10 } };
const walled = { state: "unavailable" as const, statusCode: null, reason: "no-parsable-payload", metrics: null };
const deleted = { state: "deleted" as const, statusCode: 10204, reason: null, metrics: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockProxiesConfigured = false;
  mockProxyOpens = true;
  delete process.env.TIKTOK_PROXY_GIVE_UP_STREAK;
  delete process.env.TIKTOK_PROXY_POSTS_PER_LANE;
  delete process.env.TIKTOK_PROXY_MAX_LANES;
});

describe("with no proxy configured, nothing changes", () => {
  it("opens the sandbox pool exactly as before", () => {
    const f = openTikTokPostFetcher(40);
    expect(openProxy).not.toHaveBeenCalled();
    expect(openPool).toHaveBeenCalledWith(5);
    expect(f).toBe(sandboxPool);
  });

  it("honours a caller's lane cap instead of recomputing it", () => {
    /* The cron's whole cost argument. laneCountFor(80) is 10 here; the cron
       says two, and two is what must be opened. */
    openTikTokPostFetcher(80, { sandboxLanes: 2 });
    expect(openPool).toHaveBeenCalledWith(2);
  });

  it("opens nothing for zero work", () => {
    expect(openTikTokPostFetcher(0)).toBeUndefined();
    expect(openPool).not.toHaveBeenCalled();
  });

  it("opens nothing when the caller capped lanes at zero", () => {
    expect(openTikTokPostFetcher(40, { sandboxLanes: 0 })).toBeUndefined();
    expect(openPool).not.toHaveBeenCalled();
  });

  it("uses the one-lane helper for a single post", () => {
    expect(openTikTokPostFetcherForOne()).toBe(oneLaneSandbox);
    expect(openOne).toHaveBeenCalled();
    expect(openPool).not.toHaveBeenCalled();
  });
});

describe("with proxies configured", () => {
  beforeEach(() => {
    mockProxiesConfigured = true;
  });

  it("opens the proxy pool and NOT a sandbox", () => {
    openTikTokPostFetcher(40);
    expect(openProxy).toHaveBeenCalledWith(10);
    expect(openPool).not.toHaveBeenCalled();
  });

  it("still boots no sandbox while the proxy keeps delivering", async () => {
    proxyPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    for (let i = 0; i < 20; i++) expect(await f.readPost(URL_UNDER_TEST)).toBe(live);
    expect(openPool).not.toHaveBeenCalled();
    await f.close();
  });

  it("reports the proxy lane count as its size", () => {
    expect(openTikTokPostFetcher(40)!.size).toBe(proxyPool.size);
  });

  it("falls back to sandboxes when the proxy cannot be opened at all", () => {
    mockProxyOpens = false;
    const f = openTikTokPostFetcher(40);
    expect(f).toBe(sandboxPool);
    expect(openPool).toHaveBeenCalledWith(5);
  });

  it("passes a proxied read straight through when TikTok answers", async () => {
    proxyPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(8)!;
    expect(await f.readPost(URL_UNDER_TEST)).toBe(live);
    expect(sandboxPool.readPost).not.toHaveBeenCalled();
    await f.close();
  });

  it("treats a deletion as final and does not pay for a sandbox to confirm it", async () => {
    proxyPool.readPost.mockResolvedValue(deleted);
    const f = openTikTokPostFetcher(8)!;
    expect(await f.readPost(URL_UNDER_TEST)).toBe(deleted);
    expect(openPool).not.toHaveBeenCalled();
    await f.close();
  });

  it("escalates a walled post to a sandbox -- a different address family", async () => {
    proxyPool.readPost.mockResolvedValue(walled);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    expect(await f.readPost(URL_UNDER_TEST)).toBe(live);
    expect(openPool).toHaveBeenCalledTimes(1);
    await f.close();
  });

  it("escalates a dead proxy transport too", async () => {
    proxyPool.readPost.mockResolvedValue(null);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    expect(await f.readPost(URL_UNDER_TEST)).toBe(live);
    expect(sandboxPool.readPost).toHaveBeenCalled();
    await f.close();
  });

  it("boots the sandbox pool once, not once per escalated post", async () => {
    proxyPool.readPost.mockResolvedValue(walled);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    for (let i = 0; i < 5; i++) await f.readPost(URL_UNDER_TEST);
    expect(openPool).toHaveBeenCalledTimes(1);
    await f.close();
  });

  it("never boots a sandbox when the caller capped lanes at zero", async () => {
    /* SYNC_CRON_TIKTOK_MAX_LANES=0 is the "proxies only" switch. A walled post
       then returns the proxy's own verdict rather than silently booting the
       machine the operator just turned off. */
    proxyPool.readPost.mockResolvedValue(walled);
    const f = openTikTokPostFetcher(40, { sandboxLanes: 0 })!;
    expect(await f.readPost(URL_UNDER_TEST)).toBeNull();
    expect(openPool).not.toHaveBeenCalled();
    await f.close();
  });

  it("stops asking a dead proxy pool after a streak, so posts pay one egress not two", async () => {
    process.env.TIKTOK_PROXY_GIVE_UP_STREAK = "3";
    proxyPool.readPost.mockResolvedValue(null);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    for (let i = 0; i < 6; i++) await f.readPost(URL_UNDER_TEST);
    expect(proxyPool.readPost).toHaveBeenCalledTimes(3);
    expect(sandboxPool.readPost).toHaveBeenCalledTimes(6);
    /* Closed the moment it is abandoned, not at run end -- open sockets to a
       provider we have stopped asking are pure waste. */
    expect(proxyPool.close).toHaveBeenCalled();
    await f.close();
  });

  it("counts the streak consecutively, so an occasional wall never disables the pool", async () => {
    process.env.TIKTOK_PROXY_GIVE_UP_STREAK = "3";
    proxyPool.readPost
      .mockResolvedValueOnce(walled)
      .mockResolvedValueOnce(walled)
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(walled)
      .mockResolvedValueOnce(walled)
      .mockResolvedValue(live);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    for (let i = 0; i < 6; i++) await f.readPost(URL_UNDER_TEST);
    expect(proxyPool.readPost).toHaveBeenCalledTimes(6);
    await f.close();
  });

  it("closes both pools, including one it escalated to", async () => {
    proxyPool.readPost.mockResolvedValue(walled);
    sandboxPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    await f.readPost(URL_UNDER_TEST);
    await f.close();
    expect(proxyPool.close).toHaveBeenCalled();
    expect(sandboxPool.close).toHaveBeenCalled();
  });

  it("closes cleanly when no sandbox was ever needed", async () => {
    proxyPool.readPost.mockResolvedValue(live);
    const f = openTikTokPostFetcher(40)!;
    await f.readPost(URL_UNDER_TEST);
    await f.close();
    expect(proxyPool.close).toHaveBeenCalled();
    expect(sandboxPool.close).not.toHaveBeenCalled();
  });

  it("uses one proxy identity for a single post rather than booting a sandbox", () => {
    openTikTokPostFetcherForOne();
    expect(openProxy).toHaveBeenCalledWith(1);
    expect(openOne).not.toHaveBeenCalled();
  });
});

describe("proxyLaneCountFor", () => {
  it("is zero for no work", () => {
    expect(proxyLaneCountFor(0)).toBe(0);
  });

  it("grows with the work", () => {
    expect(proxyLaneCountFor(1)).toBe(1);
    expect(proxyLaneCountFor(40)).toBe(10);
  });

  it("caps, so a huge campaign does not open a hundred sessions", () => {
    expect(proxyLaneCountFor(10_000)).toBe(16);
  });

  it("is tunable without a deploy", () => {
    process.env.TIKTOK_PROXY_POSTS_PER_LANE = "10";
    process.env.TIKTOK_PROXY_MAX_LANES = "50";
    expect(proxyLaneCountFor(200)).toBe(20);
  });
});
