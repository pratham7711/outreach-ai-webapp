/**
 * @jest-environment node
 *
 * POST /api/campaigns/audio/resolve says whether the platform confirmed the
 * sound. A TikTok link with a made-up id parses as well as a real one, and
 * the wizard used to show it under a title spelled out of the URL slug
 * (walkthrough 2026-10-13, A1#11).
 */
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/campaigns/audioLink", () => ({ identifyAudioLink: jest.fn(), checkInstagramAudio: jest.fn() }));
jest.mock("@/lib/platforms/tiktokAudioUsage", () => ({ readOneTikTokAudioUsage: jest.fn() }));

import { POST } from "@/app/api/campaigns/audio/resolve/route";
import { auth } from "@/lib/auth";
import { checkInstagramAudio, identifyAudioLink } from "@/lib/campaigns/audioLink";
import { readOneTikTokAudioUsage } from "@/lib/platforms/tiktokAudioUsage";

const resolveAs = (platform: "TIKTOK" | "INSTAGRAM", provisionalTitle: string | null) =>
  (identifyAudioLink as jest.Mock).mockResolvedValue({
    ok: true,
    audio: { platform, tiktokSoundId: "7400000000000000009", provisionalTitle },
  });

const call = () =>
  POST(new Request("http://x/api/campaigns/audio/resolve", { method: "POST", body: JSON.stringify({ url: "https://www.tiktok.com/music/WALK-Test-Sound-7400000000000000009" }) }));

beforeEach(() => {
  jest.clearAllMocks();
  // A role that may create campaigns: the route checks campaigns:create first.
  (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", role: "MANAGER" } });
});

it("marks a TikTok sound TikTok did not answer for as unverified and sends no slug title", async () => {
  resolveAs("TIKTOK", "WALK Test Sound");
  (readOneTikTokAudioUsage as jest.Mock).mockResolvedValue({ ok: false });
  const body = await (await call()).json();
  expect(body.verified).toBe(false);
  expect(body.provisionalTitle).toBeNull();
});

it("treats a read that throws as unverified too", async () => {
  resolveAs("TIKTOK", "WALK Test Sound");
  (readOneTikTokAudioUsage as jest.Mock).mockRejectedValue(new Error("timeout"));
  const body = await (await call()).json();
  expect(body.verified).toBe(false);
  expect(body.provisionalTitle).toBeNull();
});

it("keeps the title and reading for a sound TikTok answered for", async () => {
  resolveAs("TIKTOK", "Roots");
  (readOneTikTokAudioUsage as jest.Mock).mockResolvedValue({
    ok: true,
    stats: { artist: "Artist", coverImageUrl: "https://example.com/c.jpg", usesCount: 42 },
  });
  const body = await (await call()).json();
  expect(body).toMatchObject({ verified: true, provisionalTitle: "Roots", artist: "Artist", usesCount: 42 });
});

describe("an Instagram audio", () => {
  beforeEach(() => resolveAs("INSTAGRAM", null));

  it("is verified with Instagram's own title, artist, cover and reel count", async () => {
    (checkInstagramAudio as jest.Mock).mockResolvedValue({
      ok: true,
      reading: { usesCount: 2_000_000, precision: "rounded", title: "Runaway", artist: "AURORA", coverImageUrl: "https://example.com/ig.jpg" },
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      platform: "INSTAGRAM",
      soundId: "7400000000000000009",
      verified: true,
      provisionalTitle: "Runaway",
      artist: "AURORA",
      coverImageUrl: "https://example.com/ig.jpg",
      usesCount: 2_000_000,
      usesRounded: true,
    });
    expect(checkInstagramAudio).toHaveBeenCalledWith("7400000000000000009");
    expect(readOneTikTokAudioUsage).not.toHaveBeenCalled();
  });

  it("does not claim to have checked one Instagram did not answer for", async () => {
    (checkInstagramAudio as jest.Mock).mockResolvedValue({ ok: true, reading: null });
    const body = await (await call()).json();
    expect(body).toMatchObject({ platform: "INSTAGRAM", verified: null, provisionalTitle: null, usesCount: null, usesRounded: false });
  });

  it("refuses one Instagram has no such audio for, or that publishes no count", async () => {
    for (const reason of ["instagram_audio_not_found", "instagram_audio_no_count"]) {
      (checkInstagramAudio as jest.Mock).mockResolvedValue({ ok: false, reason, message: `msg ${reason}` });
      const res = await call();
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: reason, message: `msg ${reason}` });
    }
  });
});
