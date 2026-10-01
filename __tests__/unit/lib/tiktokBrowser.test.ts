/**
 * @jest-environment node
 */
import { createBrowserSession } from "@/lib/platforms/tiktokBrowser";

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
