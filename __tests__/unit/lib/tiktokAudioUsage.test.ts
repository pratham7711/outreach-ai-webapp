/**
 * @jest-environment node
 *
 * The batched sound reader.
 *
 * The parser is tested in tiktokSoundEmbed.test.ts and is used for real here --
 * only the network calls are stubbed, so a change that broke the embed shape
 * would fail these too. What these hold is the ladder and its cost:
 *
 *  - a sweep whose sounds all answer over plain egress must never boot a
 *    sandbox, because Provisioned Memory bills wall-clock and the old
 *    per-sweep boot was paid whether or not anything needed it;
 *  - the direct rung must actually run in parallel, which is the whole reason
 *    a ninety-sound sweep fits inside a function budget;
 *  - one platform id asked once, however many of our rows point at it;
 *  - and the music page stays off unless a caller asks, because it has never
 *    answered from a server and trying costs a timeout per unread sound.
 */
const mockDirect = jest.fn();
jest.mock("@/lib/platforms/tiktokSoundEmbed", () => ({
  ...jest.requireActual("@/lib/platforms/tiktokSoundEmbed"),
  fetchTikTokMusicEmbedHtmlDirect: (...args: unknown[]) => mockDirect(...args),
}));

const mockMusicPage = jest.fn();
jest.mock("@/lib/platforms/tiktokSound", () => ({
  ...jest.requireActual("@/lib/platforms/tiktokSound"),
  fetchTikTokSoundStats: (...args: unknown[]) => mockMusicPage(...args),
}));

const mockSandboxRead = jest.fn();
const mockSandboxClose = jest.fn();
const mockOpenSandbox = jest.fn();
jest.mock("@/lib/platforms/tiktokProfileSandbox", () => ({
  openSandboxProfileFetcher: (...args: unknown[]) => mockOpenSandbox(...args),
}));

import { readTikTokAudioUsage, readOneTikTokAudioUsage, isMeasuredRung } from "@/lib/platforms/tiktokAudioUsage";

const A = "7546394810303694849";
const B = "7300000000000000001";

/** The shape the embed page actually server-renders, trimmed to what we read. */
function embedHtml(id: string, videoCount: number) {
  return `<html><script>window.__x = {"embedInfo":{"coverUrl":"https://cdn/c.jpeg","artist":"Ellie Holcomb","videoCount":${videoCount},"id":"${id}","statusCode":0,"code":200}}</script></html>`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDirect.mockResolvedValue(null);
  mockMusicPage.mockResolvedValue(null);
  mockSandboxRead.mockResolvedValue(null);
  mockSandboxClose.mockResolvedValue(undefined);
  mockOpenSandbox.mockReturnValue({
    readMusicEmbedHtml: (...args: unknown[]) => mockSandboxRead(...args),
    close: (...args: unknown[]) => mockSandboxClose(...args),
  });
});

it("reads over plain egress and never opens a sandbox", async () => {
  mockDirect.mockImplementation(async (id: string) => embedHtml(id, 44));

  const out = await readTikTokAudioUsage([A]);

  expect(out.get(A)).toEqual({
    ok: true,
    rung: "embed-direct",
    stats: { usesCount: 44, title: null, artist: "Ellie Holcomb", coverImageUrl: "https://cdn/c.jpeg" },
  });
  // The cost claim, and the reason the rungs are split into two passes.
  expect(mockOpenSandbox).not.toHaveBeenCalled();
});

it("asks TikTok once for an id two rows share", async () => {
  mockDirect.mockImplementation(async (id: string) => embedHtml(id, 44));

  const out = await readTikTokAudioUsage([A, A, A]);

  expect(mockDirect).toHaveBeenCalledTimes(1);
  expect(out.size).toBe(1);
});

it("runs the direct rung in parallel", async () => {
  let inFlight = 0;
  let peak = 0;
  mockDirect.mockImplementation(async (id: string) => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return embedHtml(id, 1);
  });

  /* Built as strings, not by adding to a literal: a TikTok sound id is past
     Number.MAX_SAFE_INTEGER, so arithmetic on it collapses twelve ids into one. */
  const ids = Array.from({ length: 12 }, (_, i) => `73000000000000000${String(i).padStart(2, "0")}`);
  await readTikTokAudioUsage(ids, { concurrency: 4 });

  expect(peak).toBe(4);
});

it("boots one sandbox, only for what plain egress could not read, and closes it", async () => {
  mockDirect.mockImplementation(async (id: string) => (id === A ? embedHtml(id, 44) : null));
  mockSandboxRead.mockImplementation(async (id: string) => embedHtml(id, 7));

  const out = await readTikTokAudioUsage([A, B]);

  expect(mockOpenSandbox).toHaveBeenCalledTimes(1);
  expect(mockSandboxRead).toHaveBeenCalledTimes(1);
  expect(mockSandboxRead).toHaveBeenCalledWith(B);
  expect(out.get(A)).toMatchObject({ rung: "embed-direct" });
  expect(out.get(B)).toMatchObject({ rung: "embed-sandbox", stats: { usesCount: 7 } });
  expect(mockSandboxClose).toHaveBeenCalled();
});

it("leaves a caller's own sandbox open", async () => {
  /* A creator sweep already holds one. Closing somebody else's would kill the
     reads still queued behind ours. */
  const borrowed = {
    readMusicEmbedHtml: jest.fn().mockResolvedValue(embedHtml(B, 7)),
    close: jest.fn(),
  };

  const out = await readTikTokAudioUsage([B], { sandbox: borrowed as never });

  expect(out.get(B)).toMatchObject({ rung: "embed-sandbox" });
  expect(mockOpenSandbox).not.toHaveBeenCalled();
  expect(borrowed.close).not.toHaveBeenCalled();
});

it("does not try the music page unless asked", async () => {
  const out = await readTikTokAudioUsage([A]);

  expect(mockMusicPage).not.toHaveBeenCalled();
  expect(out.get(A)).toEqual({ ok: false, reason: "no-reading" });
});

it("tries the music page last when a caller allows it", async () => {
  mockMusicPage.mockResolvedValue({ usesCount: 52, title: "t", artist: "a", coverImageUrl: null });

  const out = await readTikTokAudioUsage([A], { allowMusicPage: true });

  expect(out.get(A)).toMatchObject({ rung: "music-page", stats: { usesCount: 52 } });
  // Last: both embed rungs were tried first.
  expect(mockDirect).toHaveBeenCalled();
  expect(mockSandboxRead).toHaveBeenCalled();
});

it("survives a rung that throws", async () => {
  mockDirect.mockRejectedValue(new Error("socket hang up"));
  mockSandboxRead.mockRejectedValue(new Error("sandbox boot failed"));

  const out = await readTikTokAudioUsage([A]);

  expect(out.get(A)).toEqual({ ok: false, reason: "no-reading" });
});

it("refuses an embed served for a different sound", async () => {
  /* TikTok echoes the id back. A page for another sound is a wrong answer, not
     a missing one, and writing it would put someone else's curve on a client's
     report. */
  mockDirect.mockResolvedValue(embedHtml("9999999999999999999", 44));

  const out = await readTikTokAudioUsage([A]);

  expect(out.get(A)).toEqual({ ok: false, reason: "no-reading" });
});

it("reports what it never reached as a deadline, not a failure", async () => {
  const out = await readTikTokAudioUsage([A], { deadlineAt: Date.now() - 1 });

  expect(out.get(A)).toEqual({ ok: false, reason: "deadline" });
  expect(mockDirect).not.toHaveBeenCalled();
  expect(mockOpenSandbox).not.toHaveBeenCalled();
});

it("tells an embed's zero apart from the music page's", async () => {
  expect(isMeasuredRung("embed-direct")).toBe(true);
  expect(isMeasuredRung("embed-sandbox")).toBe(true);
  expect(isMeasuredRung("music-page")).toBe(false);
});

it("answers a single id directly", async () => {
  mockDirect.mockImplementation(async (id: string) => embedHtml(id, 44));

  expect(await readOneTikTokAudioUsage(A)).toMatchObject({ ok: true, stats: { usesCount: 44 } });
});
