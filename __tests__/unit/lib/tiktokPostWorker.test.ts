/**
 * @jest-environment node
 *
 * Node, not jsdom: the worker's real transport binds the runtime's fetch, which
 * jsdom does not provide.
 *
 * Plan B for TikTok post reads: the worker, and the order it is asked in.
 *
 * The cases that matter are the ones that cost coverage without anyone seeing
 * it: a dead lane whose post never reaches the worker, a worker that is asked
 * about a post TikTok already answered, and a walled-everywhere post reported
 * as a dead lane because the worker also failed.
 */

let mockKilled = false;
jest.mock("@/lib/ops/killSwitch", () => ({
  fallbackKillKey: (r: string) => `source:${r}`,
  isKilled: jest.fn(async () => mockKilled),
}));
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import type { TikTokExit, ExitPage } from "@/lib/platforms/tiktokExit";
import type { SandboxPostFetcher } from "@/lib/platforms/tiktokPostSandbox";
import type { TikTokPostLookup } from "@/lib/platforms/fetchPostMetrics";
import {
  openWorkerPostFetcher,
  withWorkerFallback,
  WORKER_GIVE_UP_STREAK,
} from "@/lib/platforms/tiktokPostWorker";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7675846963421646098";
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

function fakeExit(replies: Array<ExitPage | null>): TikTokExit & { asked: string[] } {
  const asked: string[] = [];
  return {
    id: "worker-test",
    kind: "worker",
    asked,
    async fetchPage(url: string) {
      asked.push(url);
      return replies.length ? replies.shift()! : null;
    },
    async close() {},
  };
}

const live: TikTokPostLookup = {
  state: "live",
  statusCode: 0,
  reason: null,
  metrics: { caption: null, thumbnailUrl: null, postedAt: null, viewsCount: 10 },
};
const walled: TikTokPostLookup = { state: "unavailable", statusCode: null, reason: "no-parsable-payload", metrics: null };
const deleted: TikTokPostLookup = { state: "deleted", statusCode: 10204, reason: null, metrics: null };

function fakeFetcher(answers: Array<TikTokPostLookup | null>, size = 2): SandboxPostFetcher & { calls: number } {
  const f = {
    calls: 0,
    size,
    async readPost() {
      f.calls += 1;
      return answers.length ? answers.shift()! : null;
    },
    close: jest.fn(async () => {}),
  };
  return f;
}

beforeEach(() => {
  mockKilled = false;
});

describe("the worker as a post reader", () => {
  it("does not exist without TRACKER_PLAN_B_URL and TRACKER_PLAN_B_TOKEN", () => {
    expect(openWorkerPostFetcher({} as NodeJS.ProcessEnv)).toBeNull();
    expect(openWorkerPostFetcher({ TRACKER_PLAN_B_URL: "https://w.example" } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });

  it("opens from the same env the tracker switch uses", () => {
    const f = openWorkerPostFetcher({
      TRACKER_PLAN_B_URL: "https://w.example",
      TRACKER_PLAN_B_TOKEN: "t",
    } as unknown as NodeJS.ProcessEnv);
    expect(f).not.toBeNull();
    expect(f!.size).toBeGreaterThan(0);
  });

  it("reads a live page into counts, through the same parser as a lane", async () => {
    const exit = fakeExit([{ status: 200, body: page(), ms: 900 }]);
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, exit)!;
    const got = await f.readPost(URL_UNDER_TEST);
    expect(got?.state).toBe("live");
    expect(got?.metrics?.viewsCount).toBe(4165);
    expect(got?.metrics?.likesCount).toBe(535);
    expect(exit.asked).toEqual([URL_UNDER_TEST]);
  });

  it("asks for the video page when the stored url is a photo post", async () => {
    const exit = fakeExit([{ status: 200, body: page(), ms: 900 }]);
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, exit)!;
    await f.readPost("https://www.tiktok.com/@someone/photo/7675846963421646098");
    expect(exit.asked).toEqual([URL_UNDER_TEST]);
  });

  it("reports a wall as TikTok's answer, not as a dead worker", async () => {
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, fakeExit([{ status: 200, body: WALL, ms: 400 }]))!;
    expect((await f.readPost(URL_UNDER_TEST))?.state).toBe("unavailable");
  });

  it("reports a deleted post as deleted", async () => {
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, fakeExit([{ status: 200, body: page(10204), ms: 400 }]))!;
    expect((await f.readPost(URL_UNDER_TEST))?.state).toBe("deleted");
  });

  it("asks nothing while source:tiktok-worker is switched off", async () => {
    mockKilled = true;
    const exit = fakeExit([{ status: 200, body: page(), ms: 900 }]);
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, exit)!;
    expect(await f.readPost(URL_UNDER_TEST)).toBeNull();
    expect(exit.asked).toEqual([]);
  });

  it(`stops asking an unreachable worker after ${WORKER_GIVE_UP_STREAK} failures in a row`, async () => {
    const exit = fakeExit([]);
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, exit)!;
    for (let i = 0; i < WORKER_GIVE_UP_STREAK + 3; i++) expect(await f.readPost(URL_UNDER_TEST)).toBeNull();
    expect(exit.asked).toHaveLength(WORKER_GIVE_UP_STREAK);
  });

  it("forgives a failure once the worker answers again", async () => {
    const replies: Array<ExitPage | null> = [];
    for (let i = 0; i < WORKER_GIVE_UP_STREAK - 1; i++) replies.push(null);
    replies.push({ status: 200, body: page(), ms: 900 });
    for (let i = 0; i < WORKER_GIVE_UP_STREAK - 1; i++) replies.push(null);
    replies.push({ status: 200, body: page(), ms: 900 });
    const exit = fakeExit(replies);
    const f = openWorkerPostFetcher({} as NodeJS.ProcessEnv, exit)!;
    for (let i = 0; i < 2 * WORKER_GIVE_UP_STREAK; i++) await f.readPost(URL_UNDER_TEST);
    expect(exit.asked).toHaveLength(2 * WORKER_GIVE_UP_STREAK);
  });
});

describe("plan A, then the worker", () => {
  it("is plan A itself when there is no worker, so nothing changes without the env", () => {
    const a = fakeFetcher([]);
    expect(withWorkerFallback(a, null)).toBe(a);
    expect(withWorkerFallback(undefined, null)).toBeUndefined();
  });

  it("is the worker alone when plan A opened no lanes", () => {
    const b = fakeFetcher([]);
    expect(withWorkerFallback(undefined, b)).toBe(b);
  });

  it("never asks the worker about a post plan A read", async () => {
    const a = fakeFetcher([live]);
    const b = fakeFetcher([live]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(live);
    expect(b.calls).toBe(0);
  });

  it("never asks the worker about a post TikTok says is deleted", async () => {
    const a = fakeFetcher([deleted]);
    const b = fakeFetcher([live]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(deleted);
    expect(b.calls).toBe(0);
  });

  it("hands a dead lane's post to the worker", async () => {
    const a = fakeFetcher([null]);
    const b = fakeFetcher([live]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(live);
  });

  it("hands a walled-everywhere post to the worker", async () => {
    const a = fakeFetcher([walled]);
    const b = fakeFetcher([live]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(live);
  });

  it("keeps plan A's refusal when the worker cannot do better", async () => {
    const a = fakeFetcher([walled]);
    const b = fakeFetcher([null]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(walled);
  });

  it("reports the worker's wall, not a dead lane, when plan A never asked", async () => {
    const a = fakeFetcher([null]);
    const b = fakeFetcher([walled]);
    expect(await withWorkerFallback(a, b)!.readPost(URL_UNDER_TEST)).toBe(walled);
  });

  it("is null only when neither side reached TikTok", async () => {
    expect(await withWorkerFallback(fakeFetcher([null]), fakeFetcher([null]))!.readPost(URL_UNDER_TEST)).toBeNull();
  });

  it("runs at plan A's concurrency, or the worker's when plan A has no lanes left", () => {
    expect(withWorkerFallback(fakeFetcher([], 6), fakeFetcher([], 2))!.size).toBe(6);
    expect(withWorkerFallback(fakeFetcher([], 0), fakeFetcher([], 2))!.size).toBe(2);
  });

  it("closes both", async () => {
    const a = fakeFetcher([]);
    const b = fakeFetcher([]);
    await withWorkerFallback(a, b)!.close();
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
  });
});
