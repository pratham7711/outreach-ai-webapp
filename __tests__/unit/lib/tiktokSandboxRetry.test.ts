/**
 * A wall is a fact about one address at one moment, not about the post -- so a
 * refusal on one lane has to be re-asked on another before the post is written
 * off. These tests exist for the other half of that: retrying against a WAF is
 * the classic way to build a loop that never ends, so every bound is pinned
 * here rather than argued in a comment.
 */

const mockCalls: Array<{ region: string; url: string }> = [];
const mockCreated: string[] = [];
let mockBootFails: Set<string>;
let mockRespond: (region: string) => string;

jest.mock("@vercel/sandbox", () => ({
  Sandbox: {
    create: jest.fn(async ({ region }: { region: string }) => {
      mockCreated.push(region);
      if (mockBootFails.has(region)) throw new Error(`no capacity in ${region}`);
      return {
        runCommand: async (_cmd: string, args: string[]) => {
          const url = args[args.length - 1];
          mockCalls.push({ region, url });
          return { stdout: mockRespond(region) };
        },
        stop: async () => {},
      };
    }),
  },
}));

import { openSandboxPostPool } from "@/lib/platforms/tiktokPostSandbox";

const URL = "https://www.tiktok.com/@someone/video/7675846963421646098";

/** HTTP 200 with no rehydration payload: the Slardar login shell. */
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

/** Lanes are handed regions in order, so for <=4 lanes the region names them. */
const LANES = ["iad1", "sfo1", "cle1", "cdg1"];

beforeEach(() => {
  mockCalls.length = 0;
  mockCreated.length = 0;
  mockBootFails = new Set();
  mockRespond = () => page();
  // The gate's pacing is real time; these tests are about ordering, not pace.
  process.env.TIKTOK_SANDBOX_MIN_GAP_MS = "0";
  process.env.TIKTOK_SANDBOX_JITTER_MS = "0";
  delete process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS;
});

afterEach(() => {
  delete process.env.TIKTOK_SANDBOX_MIN_GAP_MS;
  delete process.env.TIKTOK_SANDBOX_JITTER_MS;
  delete process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS;
});

describe("readPost retries on a different address", () => {
  it("re-asks a walled post from another lane and gets the page", async () => {
    mockRespond = (region) => (region === "iad1" ? WALL : page());
    const pool = openSandboxPostPool(2);

    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("live");
    expect(lookup?.metrics?.viewsCount).toBe(4165);
    expect(mockCalls.map((c) => c.region)).toEqual(["iad1", "sfo1"]);
  });

  it("never asks the same address twice for one post", async () => {
    // Every lane walls it, so the loop runs to its budget rather than stopping
    // early -- which is exactly when a naive retry would re-ask lane 0.
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(4);

    await pool.readPost(URL);

    const regions = mockCalls.map((c) => c.region);
    expect(new Set(regions).size).toBe(regions.length);
  });

  it("routes around a lane that could not boot", async () => {
    mockBootFails = new Set(["iad1"]);
    const pool = openSandboxPostPool(2);

    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("live");
    expect(mockCalls.map((c) => c.region)).toEqual(["sfo1"]);
    expect(pool.size).toBe(1); // the dead lane is retired, not retried
  });
});

describe("readPost is bounded", () => {
  it("stops at the attempt budget even with more lanes available", async () => {
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(4);

    await pool.readPost(URL);

    expect(mockCalls).toHaveLength(3); // the default budget, not the 4 lanes
  });

  it("stops at the lane count when it is smaller than the budget", async () => {
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(1);

    await pool.readPost(URL);

    expect(mockCalls).toHaveLength(1);
  });

  it("honours a configured budget", async () => {
    process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS = "2";
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(4);

    await pool.readPost(URL);

    expect(mockCalls).toHaveLength(2);
  });

  it("asks once about a deleted post and accepts the answer", async () => {
    /* The retry loop's real hazard: a post TikTok will call gone from every
       address forever. Re-asking it spends a paced slot per lane and cannot
       change the outcome. */
    mockRespond = () => page(10204);
    const pool = openSandboxPostPool(4);

    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("deleted");
    expect(mockCalls).toHaveLength(1);
  });

  it("asks once when the first address answers", async () => {
    const pool = openSandboxPostPool(4);

    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("live");
    expect(mockCalls).toHaveLength(1);
  });

  it("gives up rather than spinning when every lane is dead", async () => {
    mockBootFails = new Set(LANES);
    const pool = openSandboxPostPool(3);

    expect(await pool.readPost(URL)).toBeNull();
    const bootAttempts = mockCreated.length;
    expect(pool.size).toBe(0);

    // A second post must not re-attempt lanes already known dead.
    expect(await pool.readPost(URL)).toBeNull();
    expect(mockCreated).toHaveLength(bootAttempts);
  });

  it("reports the wall rather than a verdict, so the direct egress still runs", async () => {
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(2);

    const lookup = await pool.readPost(URL);

    // Not "deleted" -- we never learned anything about the post itself.
    expect(lookup?.state).toBe("unavailable");
    expect(lookup?.metrics).toBeNull();
  });
});

describe("readPost spends its attempts on addresses, not on wreckage", () => {
  it("does not re-ask the one live lane when the others are dead", async () => {
    /* The case round-robin alone gets wrong: with three lanes retired, pick()
       keeps returning the same survivor, and without the tried-set the post
       would be asked of ONE address three times -- three paced slots, three
       identical answers, and the pretence of having retried. */
    mockBootFails = new Set(["iad1", "sfo1", "cle1"]);
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(4);

    await pool.readPost(URL);

    expect(mockCalls.map((c) => c.region)).toEqual(["cdg1"]);
  });

  it("still reaches a healthy lane sitting behind failed boots", async () => {
    /* Boot failures must not consume the attempt budget: three dead lanes plus
       a budget of three would otherwise mean the post is never asked at all. */
    mockBootFails = new Set(["iad1", "sfo1", "cle1"]);
    const pool = openSandboxPostPool(4);

    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("live");
    expect(mockCalls.map((c) => c.region)).toEqual(["cdg1"]);
  });
});
