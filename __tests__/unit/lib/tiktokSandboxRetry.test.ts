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
  delete process.env.TIKTOK_SANDBOX_CHALLENGE_THRESHOLD;
  delete process.env.TIKTOK_SANDBOX_MAX_REPLACEMENTS;
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

  it("buys a fresh address rather than stopping at the lane count", async () => {
    /* CHANGED DELIBERATELY. This asserted one call for a one-lane pool -- the
       attempt budget was capped at the number of addresses held, so a walled
       post on a one-lane pool was asked once and written off.
       
       That cap was right while addresses were fixed, and it is what the per-post
       Sync Now button hit on production: it opens a single lane, so one wall
       exhausted the pool. Refresh Data measured the same post successfully at
       the same moment, because it holds several lanes. Sandboxes are addresses
       on demand, so the budget is now the attempt budget (default 3) and the
       lane count is no longer a ceiling on it.
       
       Still bounded, and by two separate things: maxAttempts, and the per-run
       replacement budget asserted in the suite below. */
    mockRespond = () => WALL;
    const pool = openSandboxPostPool(1);

    await pool.readPost(URL);

    expect(mockCalls).toHaveLength(3); // the default attempt budget
    // Three requests means three DIFFERENT addresses, which is the whole point.
    expect(mockCreated).toEqual(["iad1", "sfo1", "cle1"]);
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

/**
 * A burned lane is replaced, not written off.
 *
 * Measured in production on 2026-09-02: a 58-post refresh reported 27 measured,
 * 15 "skipped while backing off" and 13 refused. The fifteen were never asked
 * about at all -- their lanes had latched, and a latched gate stays shut for its
 * cooldown (10 minutes for the breaker, 5 for challenges) while the whole
 * refresh has a 260-second deadline. So inside one run "backing off" did not
 * mean "wait", it meant "this address is gone", and the retry sweeps re-entered
 * the same pool holding the same burned addresses.
 *
 * A cooldown is a statement about ONE IP and every sandbox gets its own, so
 * booting another IS the wait, completed in seconds.
 */
describe("a latched lane is re-addressed", () => {
  beforeEach(() => {
    // One wall latches the gate, so these tests do not need ten round trips.
    process.env.TIKTOK_SANDBOX_CHALLENGE_THRESHOLD = "1";
  });

  it("gets a one-lane pool a second and third address when the first is walled", async () => {
    /* The per-post Sync Now button opens exactly one lane. Before replacement
       existed its budget was min(maxAttempts, lanes.length) = 1: one attempt on
       one address, and if that IP was walled the post was reported unmeasurable
       having been asked once. */
    mockRespond = () => WALL;
    process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS = "3";

    const pool = openSandboxPostPool(1);
    await pool.readPost(URL);

    // Three distinct sandboxes, hence three distinct egress IPs, from one lane.
    expect(mockCreated).toEqual(["iad1", "sfo1", "cle1"]);
    expect(mockCalls).toHaveLength(3);
  });

  it("finds the page on a replacement address", async () => {
    // The first address walls; anything booted afterwards answers properly.
    let booted = 0;
    mockRespond = () => (booted++ === 0 ? WALL : page());
    process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS = "3";

    const pool = openSandboxPostPool(1);
    const lookup = await pool.readPost(URL);

    /* The post is measured. This is the outcome the production run could not
       reach: one lane, walled, and previously that was the end of it. */
    expect(lookup?.state).toBe("live");
    expect(lookup?.metrics?.viewsCount).toBe(4165);
  });

  it("stays inside its replacement budget", async () => {
    // "Boot until it works" against a WAF is how a refresh turns into a bill.
    mockRespond = () => WALL;
    process.env.TIKTOK_SANDBOX_MAX_ATTEMPTS = "50";
    process.env.TIKTOK_SANDBOX_MAX_REPLACEMENTS = "2";

    const pool = openSandboxPostPool(1);
    await pool.readPost(URL);

    // The original plus exactly two replacements, never more.
    expect(mockCreated).toHaveLength(3);
  });

  it("does not replace a lane that is answering", async () => {
    mockRespond = () => page();
    const pool = openSandboxPostPool(2);

    await pool.readPost(URL);
    await pool.readPost(URL);
    await pool.readPost(URL);

    /* A working address is the thing we are trying to obtain, so churning it
       would be strictly worse than doing nothing -- and each boot costs seconds
       the refresh does not have. */
    expect(mockCreated).toEqual(["iad1", "sfo1"]);
  });

  it("spends no replacements when nothing has latched", async () => {
    mockRespond = () => page();
    process.env.TIKTOK_SANDBOX_MAX_REPLACEMENTS = "0";

    const pool = openSandboxPostPool(1);
    const lookup = await pool.readPost(URL);

    expect(lookup?.state).toBe("live");
    expect(mockCreated).toEqual(["iad1"]);
  });
});
