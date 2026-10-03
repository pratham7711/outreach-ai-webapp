/**
 * @jest-environment node
 */
import { createBrowserSession, isResourceExhaustion } from "@/lib/platforms/tiktokBrowser";

jest.mock("playwright-core", () => ({ chromium: { launch: jest.fn() } }));

import { chromium } from "playwright-core";

const mockLaunch = chromium.launch as unknown as jest.Mock;

function fakeBrowser(newPage: () => Promise<unknown>) {
  return { newPage: jest.fn(newPage), close: jest.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockLaunch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the browser session's keeper page", () => {
  it("fails the read when opening the keeper page never settles, instead of hanging it", async () => {
    const wedged = fakeBrowser(() => new Promise(() => {}));
    mockLaunch.mockResolvedValue(wedged);
    const session = createBrowserSession(async () => "read");

    const read = session.read("someone");
    const outcome = expect(read).rejects.toThrow("browser launch exceeded 60000ms");
    await jest.advanceTimersByTimeAsync(60_000);
    await outcome;

    expect(wedged.close).toHaveBeenCalled();
  });

  it("relaunches for the next read rather than waiting on the wedged one", async () => {
    const wedged = fakeBrowser(() => new Promise(() => {}));
    const healthy = fakeBrowser(() => Promise.resolve({}));
    mockLaunch.mockResolvedValueOnce(wedged).mockResolvedValueOnce(healthy);
    const session = createBrowserSession(async () => "read");

    const first = session.read("someone");
    const outcome = expect(first).rejects.toThrow("browser launch exceeded");
    await jest.advanceTimersByTimeAsync(60_000);
    await outcome;

    await expect(session.read("someone")).resolves.toBe("read");
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });
});

/* MEASURED in production logs 2026-09-30 to 10-02: once one page failed with
   net::ERR_INSUFFICIENT_RESOURCES, every later browser read in that run failed
   the same way, relaunch after relaunch. */
describe("a function instance out of resources", () => {
  const exhausted = () =>
    new Error("page.goto: net::ERR_INSUFFICIENT_RESOURCES at https://www.tiktok.com/@someone\nCall log: ...");

  it("recognises Chromium's message and nothing else", () => {
    expect(isResourceExhaustion(exhausted())).toBe(true);
    expect(isResourceExhaustion(new Error("browser read exceeded 90000ms"))).toBe(false);
  });

  it("stops reading for the rest of the run when the caller asks it to", async () => {
    mockLaunch.mockResolvedValue(fakeBrowser(() => Promise.resolve({})));
    const readWith = jest.fn().mockRejectedValueOnce(exhausted()).mockResolvedValue("read");
    const session = createBrowserSession(readWith, { stopWhenExhausted: true });

    await expect(session.read("first")).rejects.toThrow("ERR_INSUFFICIENT_RESOURCES");
    await expect(session.read("second")).resolves.toBeNull();
    expect(readWith).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  it("keeps relaunching by default, and after any other failure", async () => {
    mockLaunch.mockResolvedValue(fakeBrowser(() => Promise.resolve({})));
    const plain = jest.fn().mockRejectedValueOnce(exhausted()).mockResolvedValue("read");
    const session = createBrowserSession(plain);
    await expect(session.read("first")).rejects.toThrow();
    await expect(session.read("second")).resolves.toBe("read");

    const other = jest.fn().mockRejectedValueOnce(new Error("page crashed")).mockResolvedValue("read");
    const opted = createBrowserSession(other, { stopWhenExhausted: true });
    await expect(opted.read("first")).rejects.toThrow("page crashed");
    await expect(opted.read("second")).resolves.toBe("read");
  });
});
