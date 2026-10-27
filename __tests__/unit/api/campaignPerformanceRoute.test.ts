/**
 * @jest-environment node
 *
 * GET /api/campaigns/[id]/performance answers the Performance tab, which never
 * renders the per-post rows, and Settings' audio panel, which needs only the
 * sound. Neither should be sent the rest.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: { campaign: { findFirst: jest.fn(), count: jest.fn() } } }));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/reports/campaignPerformance", () => ({
  computeCampaignPerformance: jest.fn(),
  loadCampaignAudio: jest.fn(),
}));
jest.mock("@/lib/songs/songLinks", () => ({ readSongSpotifyLink: jest.fn(), songLinksReady: jest.fn() }));
jest.mock("@/lib/songs/songSounds", () => ({ readSongSounds: jest.fn(), readSongSoundIds: jest.fn() }));

import { GET } from "@/app/api/campaigns/[id]/performance/route";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignPerformance, loadCampaignAudio } from "@/lib/reports/campaignPerformance";
import { readSongSpotifyLink, songLinksReady } from "@/lib/songs/songLinks";
import { readSongSoundIds, readSongSounds } from "@/lib/songs/songSounds";

const params = { params: Promise.resolve({ id: "camp-1" }) };
const req = (qs = "") => new NextRequest(`http://localhost/api/campaigns/camp-1/performance${qs}`);
const audio = { title: "Song", artist: "A", coverUrl: null, uses: 10, usageSeries: [] };
const instagramAudio = { title: "Song", artist: "A", coverUrl: null, uses: 2_000_000, usageSeries: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "OWNER", campaignScope: "ALL" });
  (db.campaign.findFirst as jest.Mock).mockResolvedValue({ id: "camp-1", orgId: "org-1", budget: null, currency: "USD" });
  (computeCampaignPerformance as jest.Mock).mockResolvedValue({
    currency: "USD", kpis: { views: 5 }, timeSeries: [], seriesPlatforms: [], platformSplit: [], leaderboard: [],
    posts: [{ id: "p1" }], audio, instagramAudio: null,
  });
  (loadCampaignAudio as jest.Mock).mockResolvedValue({ audio, instagramAudio: null });
  (readSongSounds as jest.Mock).mockResolvedValue({ ready: true, tiktok: null, instagram: null });
  (readSongSoundIds as jest.Mock).mockResolvedValue({ tiktok: null, instagram: null });
  (db.campaign.count as jest.Mock).mockResolvedValue(0);
  (songLinksReady as jest.Mock).mockResolvedValue(true);
});

it("returns the report without the per-post rows", async () => {
  const body = await (await GET(req(), params)).json();
  expect(body.posts).toBeUndefined();
  expect(Object.keys(body).sort()).toEqual(["audio", "currency", "instagramAudio", "kpis", "leaderboard", "platformSplit", "seriesPlatforms", "timeSeries"]);
});

it("answers ?only=audio from the audio loader alone, without the chart", async () => {
  const body = await (await GET(req("?only=audio"), params)).json();
  // No song, so no link to read: the Spotify field starts empty, and no other campaign shares it.
  expect(body).toEqual({
    audio,
    instagramAudio: null,
    instagramReady: true,
    sharedWith: 0,
    spotify: { ready: true, trackId: null, url: null },
  });
  expect(readSongSpotifyLink).not.toHaveBeenCalled();
  expect(db.campaign.count).not.toHaveBeenCalled();
  expect(computeCampaignPerformance).not.toHaveBeenCalled();
  expect(loadCampaignAudio).toHaveBeenCalledWith("camp-1", "org-1", { series: false });
});

it("holds the Spotify field on a campaign with no song while the link column does not exist", async () => {
  // Saving would create the song with its link, which the PATCH refuses with a 503 until then.
  (songLinksReady as jest.Mock).mockResolvedValue(false);
  const body = await (await GET(req("?only=audio"), params)).json();
  expect(songLinksReady).toHaveBeenCalledWith("org-1");
  expect(body.spotify).toEqual({ ready: false, trackId: null, url: null });
});

it("hands Settings the song's linked Spotify track, and says when a link cannot be stored yet", async () => {
  (db.campaign.findFirst as jest.Mock).mockResolvedValue({ id: "camp-1", orgId: "org-1", budget: null, currency: "USD", song: { id: "song-1", soundId: null } });
  (readSongSpotifyLink as jest.Mock).mockResolvedValue({ ready: true, trackId: "4uLU6hMCjMI75M1A2tKUQC" });
  let body = await (await GET(req("?only=audio"), params)).json();
  expect(readSongSpotifyLink).toHaveBeenCalledWith("org-1", "song-1");
  expect(body.spotify).toEqual({ ready: true, trackId: "4uLU6hMCjMI75M1A2tKUQC", url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC" });

  (readSongSpotifyLink as jest.Mock).mockResolvedValue({ ready: false, trackId: null });
  body = await (await GET(req("?only=audio"), params)).json();
  expect(body.spotify).toEqual({ ready: false, trackId: null, url: null });
});

it("hands Settings both sounds, whether the Instagram slot can be written, and how many campaigns share the song", async () => {
  (db.campaign.findFirst as jest.Mock).mockResolvedValue({ id: "camp-1", orgId: "org-1", budget: null, currency: "USD", song: { id: "song-1" } });
  (readSongSpotifyLink as jest.Mock).mockResolvedValue({ ready: false, trackId: null });
  (loadCampaignAudio as jest.Mock).mockResolvedValue({ audio, instagramAudio });
  (readSongSounds as jest.Mock).mockResolvedValue({ ready: false, tiktok: null, instagram: null });
  (db.campaign.count as jest.Mock).mockResolvedValue(2);
  const body = await (await GET(req("?only=audio"), params)).json();
  expect(body).toMatchObject({ audio, instagramAudio, instagramReady: false, sharedWith: 2 });
  expect(readSongSounds).toHaveBeenCalledWith("org-1", "song-1");
  // Other live campaigns of this org on this song, never this one.
  expect(db.campaign.count).toHaveBeenCalledWith({
    where: { orgId: "org-1", songId: "song-1", deletedAt: null, id: { not: "camp-1" } },
  });
});

it("the full report carries the Instagram audio card beside the TikTok one", async () => {
  (computeCampaignPerformance as jest.Mock).mockResolvedValue({
    currency: "USD", kpis: { views: 5 }, timeSeries: [], seriesPlatforms: [], platformSplit: [], leaderboard: [],
    posts: [], audio: null, instagramAudio,
  });
  const body = await (await GET(req(), params)).json();
  expect(body.audio).toBeNull();
  expect(body.instagramAudio).toEqual(instagramAudio);
});

it("still 404s a campaign outside the caller's org or scope on the light path", async () => {
  (db.campaign.findFirst as jest.Mock).mockResolvedValue(null);
  const res = await GET(req("?only=audio"), params);
  expect(res.status).toBe(404);
  expect(loadCampaignAudio).not.toHaveBeenCalled();
});
