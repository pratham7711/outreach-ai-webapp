/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("@/components/ds", () => ({
  Button: ({ children, onClick, disabled, iconLeft }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {iconLeft}
      {children}
    </button>
  ),
}));

jest.mock("@/lib/postMedia", () => ({ imgSrc: (u: string) => u }));

import { CampaignAudioSetup } from "@/components/campaigns/CampaignAudioSetup";

/* One fetch mock standing in for three endpoints: the performance read that
   says what the campaign already tracks, the resolve that previews a link,
   and the PATCH that attaches or removes one. */
function mockApi({
  audio = null as any,
  instagramAudio = null as any,
  instagramReady = true,
  sharedWith = 0,
  resolve = {} as any,
  patchOk = true,
} = {}) {
  global.fetch = jest.fn(async (url: any) => {
    const href = String(url);
    if (href.includes("/performance")) {
      return { ok: true, json: async () => ({ audio, instagramAudio, instagramReady, sharedWith }) } as any;
    }
    if (href.includes("/audio/resolve")) {
      return {
        ok: resolve.ok !== false,
        status: resolve.status ?? (resolve.ok === false ? 502 : 200),
        json: async () =>
          resolve.ok === false
            ? { error: resolve.error, message: resolve.message ?? "no" }
            : (resolve.body ?? { platform: "TIKTOK", soundId: "7208251152978151425", provisionalTitle: "Roots" }),
      } as any;
    }
    // the PATCH
    return { ok: patchOk, json: async () => ({ id: "camp-1" }) } as any;
  }) as any;
  return global.fetch as jest.Mock;
}

const setup = () => render(<CampaignAudioSetup campaignId="camp-1" />);
const section = (name: string) => screen.getByRole("region", { name });
const patches = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH");

describe("CampaignAudioSetup — a campaign with no sound", () => {
  it("offers a TikTok sound, an Instagram audio and a Spotify link, each on its own", async () => {
    mockApi();
    setup();
    expect(await screen.findByRole("button", { name: /add tiktok sound/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add instagram audio/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Spotify link")).toBeInTheDocument();
    expect(screen.getByText(/videos on TikTok, reels on Instagram, plays on Spotify/)).toBeInTheDocument();
  });

  it("leaves a post link out, says why, and spends no round trip on it", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add tiktok sound/i }));
    fireEvent.change(screen.getByLabelText("TikTok sound link"), {
      target: { value: "https://www.tiktok.com/@someone/video/123" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const slot = section("Add TikTok sound");
    expect(await within(slot).findByTestId("audio-link-not-added")).toHaveTextContent(
      "Not added. That's a link to a post, not its sound."
    );
    expect(screen.getByLabelText("TikTok sound link")).toHaveValue("");
    expect(within(slot).queryByRole("alert")).toBeNull();
    // Nothing beyond the initial performance read was requested.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("resolve"))).toHaveLength(0);
  });

  it("hands an Instagram audio given to the TikTok section to its own, and checks it there", async () => {
    const igUrl = "https://www.instagram.com/reels/audio/1180417966306130/";
    const fetchMock = mockApi({
      resolve: {
        body: {
          platform: "INSTAGRAM", soundId: "1180417966306130", verified: true, provisionalTitle: "Runaway",
          artist: "AURORA", coverImageUrl: null, usesCount: 2_000_000, usesRounded: true,
        },
      },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add tiktok sound/i }));
    fireEvent.change(screen.getByLabelText("TikTok sound link"), { target: { value: igUrl } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    // The TikTok section closes; the Instagram one opens with the link, checked.
    expect(await screen.findByText("Runaway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add tiktok sound/i })).toBeInTheDocument();
    const slot = section("Add Instagram audio");
    expect(within(slot).getByTestId("audio-link-moved")).toHaveTextContent("Moved here from TikTok sound.");
    expect(within(slot).getByText(/STEP 2 OF 3/)).toBeInTheDocument();
    const asked = fetchMock.mock.calls.filter((c) => String(c[0]).includes("resolve"));
    expect(asked).toHaveLength(1);
    expect(JSON.parse(asked[0][1].body)).toEqual({ url: igUrl });
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("hands a Spotify link given to a sound section to the Spotify field", async () => {
    const spotifyUrl = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
    mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add instagram audio/i }));
    fireEvent.change(screen.getByLabelText("Instagram audio link"), { target: { value: spotifyUrl } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(screen.getByLabelText("Spotify link")).toHaveValue(spotifyUrl));
    expect(within(section("Spotify track")).getByTestId("audio-link-moved")).toHaveTextContent(
      "Moved here from Instagram audio."
    );
    expect(screen.getByRole("button", { name: /add instagram audio/i })).toBeInTheDocument();
  });

  it("shows what the link resolved to before anything is written", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add tiktok sound/i }));
    fireEvent.change(screen.getByLabelText("TikTok sound link"), {
      target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/STEP 2 OF 3/)).toBeInTheDocument();
    expect(screen.getByText("Roots")).toBeInTheDocument();
    expect(screen.getByText(/7208251152978151425/)).toBeInTheDocument();
    /* The distinction the stepper exists for: a shortened link is opaque, so
       the operator confirms the sound rather than the URL. */
    expect(screen.getByText(/Nothing has been attached yet/i)).toBeInTheDocument();
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("attaches only on the confirm step", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add tiktok sound/i }));
    fireEvent.change(screen.getByLabelText("TikTok sound link"), {
      target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => expect(screen.getByText(/STEP 3 OF 3/)).toBeInTheDocument());
    expect(JSON.parse(patches(fetchMock)[0][1].body)).toEqual({
      audioUrl: "https://www.tiktok.com/music/Roots-7208251152978151425",
    });
  });

  it("attaches an Instagram audio with its reel count, and its cover when there is no TikTok sound", async () => {
    const fetchMock = mockApi({
      resolve: {
        body: {
          platform: "INSTAGRAM", soundId: "1180417966306130", verified: true, provisionalTitle: "Runaway",
          artist: "AURORA", coverImageUrl: "https://cdn/ig.jpg", usesCount: 2_000_000, usesRounded: true,
        },
      },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add instagram audio/i }));
    fireEvent.change(screen.getByLabelText("Instagram audio link"), {
      target: { value: "https://www.instagram.com/reels/audio/1180417966306130/" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("Runaway")).toBeInTheDocument();
    expect(screen.getByText(/AURORA · ≈2M reels/)).toBeInTheDocument();
    expect(screen.getByText(/This cover art becomes the campaign.s thumbnail/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start tracking/i }));
    await waitFor(() => expect(screen.getByText(/Tracking this audio/)).toBeInTheDocument());
    expect(JSON.parse(patches(fetchMock)[0][1].body)).toEqual({
      audioUrl: "https://www.instagram.com/reels/audio/1180417966306130/",
      thumbnailUrl: "https://cdn/ig.jpg",
    });
  });

  it("leaves original audio out at the link step, with why", async () => {
    mockApi({
      resolve: { ok: false, status: 400, error: "instagram_audio_no_count", message: "Instagram doesn't publish a use count for that audio." },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add instagram audio/i }));
    fireEvent.change(screen.getByLabelText("Instagram audio link"), {
      target: { value: "https://www.instagram.com/reels/audio/932615931412635/" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByTestId("audio-link-not-added")).toHaveTextContent("Not added. That's original audio.");
    expect(screen.getByLabelText("Instagram audio link")).toHaveValue("");
    expect(screen.getByText(/STEP 1 OF 3/)).toBeInTheDocument();
  });

  it("keeps the link when Instagram did not answer, and says so", async () => {
    mockApi({ resolve: { ok: false, status: 502, message: "We couldn't reach Instagram to check that audio just now." } });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add instagram audio/i }));
    const igUrl = "https://www.instagram.com/reels/audio/1180417966306130/";
    fireEvent.change(screen.getByLabelText("Instagram audio link"), { target: { value: igUrl } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reach Instagram to check that audio just now.");
    expect(screen.getByLabelText("Instagram audio link")).toHaveValue(igUrl);
    expect(screen.queryByTestId("audio-link-not-added")).toBeNull();
  });
});

describe("CampaignAudioSetup — a campaign that already tracks audio", () => {
  const audio = { title: "Roots", artist: "Jamie MacDonald", coverUrl: "https://cdn/c.jpg", uses: 222, platform: "TIKTOK" };
  const instagramAudio = { title: "Roots", artist: "Jamie MacDonald", coverUrl: null, uses: 2_000_000, usesRounded: true, platform: "INSTAGRAM" };

  it("shows each sound, its usage in its platform's unit, with Change and Remove", async () => {
    mockApi({ audio, instagramAudio });
    setup();
    await screen.findByText(/Jamie MacDonald · 222 videos/);
    expect(within(section("TikTok sound")).getByRole("button", { name: /change/i })).toBeInTheDocument();
    expect(within(section("Instagram audio")).getByText(/Jamie MacDonald · ≈2M reels/)).toBeInTheDocument();
    expect(within(section("Instagram audio")).getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("removes one platform's sound by name, never by deleting it, and reloads", async () => {
    const fetchMock = mockApi({ audio, instagramAudio });
    setup();
    await screen.findByText(/≈2M reels/);
    fireEvent.click(within(section("Instagram audio")).getByRole("button", { name: /remove/i }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    const [href, init] = patches(fetchMock)[0];
    expect(href).toBe("/api/campaigns/camp-1");
    expect(JSON.parse(init.body)).toEqual({ removeAudio: "INSTAGRAM" });
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/performance"))).toHaveLength(2));
  });

  it("keeps the campaign's thumbnail when an Instagram audio joins a TikTok sound", async () => {
    const fetchMock = mockApi({
      audio,
      resolve: { body: { platform: "INSTAGRAM", soundId: "1180417966306130", verified: true, provisionalTitle: "Roots", coverImageUrl: "https://cdn/ig.jpg", usesCount: 5 } },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add instagram audio/i }));
    fireEvent.change(screen.getByLabelText("Instagram audio link"), {
      target: { value: "https://www.instagram.com/reels/audio/1180417966306130/" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/The campaign keeps its thumbnail: it comes from the TikTok sound/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /start tracking/i }));
    await waitFor(() => expect(patches(fetchMock)).toHaveLength(1));
    expect(JSON.parse(patches(fetchMock)[0][1].body)).toEqual({ audioUrl: "https://www.instagram.com/reels/audio/1180417966306130/" });
  });

  it("says when the song is shared, because changes reach the other campaigns", async () => {
    mockApi({ audio, sharedWith: 2 });
    setup();
    expect(await screen.findByRole("note")).toHaveTextContent("This track is also on 2 other campaigns. Links you change here change there too.");
  });

  it("holds Add for the other platform while a song can hold only one sound", async () => {
    mockApi({ audio, instagramReady: false });
    setup();
    const add = await screen.findByRole("button", { name: /add instagram audio/i });
    expect(add).toBeDisabled();
    expect(within(section("Instagram audio")).getByText("Can't be added beside the TikTok sound yet. Try again later.")).toBeInTheDocument();
    // The TikTok sound itself can still be changed.
    expect(within(section("TikTok sound")).getByRole("button", { name: /change/i })).not.toBeDisabled();
  });
});

/* Walkthrough 2026-10-13 A1#11: a TikTok id TikTok does not know used to be
   shown under a title spelled out of the URL slug. The route now says it was
   not verified and sends no title. */
describe("CampaignAudioSetup — a sound TikTok did not confirm", () => {
  it("says so and invents no title", async () => {
    mockApi({
      resolve: { body: { platform: "TIKTOK", soundId: "7400000000000000009", verified: false, provisionalTitle: null } },
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add tiktok sound/i }));
    fireEvent.change(screen.getByLabelText("TikTok sound link"), {
      target: { value: "https://www.tiktok.com/music/WALK-Test-Sound-7400000000000000009" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Sound not verified")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn.t find or verify this sound on TikTok/);
    expect(screen.queryByText(/WALK Test Sound/)).toBeNull();
  });
});

/**
 * The song's Spotify link, under the sound in Settings, with its own Save.
 * GET ?only=audio says what is linked (and whether a link can be stored at
 * all); PATCH { spotifyUrl } sets, replaces or clears it.
 */
describe("CampaignAudioSetup — Spotify link", () => {
  const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
  const OTHER = "0AbCdEfGhIjKlMnOpQrStU";
  const url = (id: string) => `https://open.spotify.com/track/${id}`;

  function spotifyApi({
    spotify = { ready: true, trackId: null, url: null } as { ready: boolean; trackId: string | null; url: string | null },
    patch = { status: 200, body: {} as unknown },
  } = {}) {
    let linked = spotify;
    const fetchMock = jest.fn(async (href: string, init?: { method?: string; body?: string }) => {
      if (href.includes("/performance")) return { ok: true, json: async () => ({ audio: null, spotify: linked }) };
      if (href.startsWith("/api/songs/spotify-check")) {
        const asked = decodeURIComponent(href.split("url=")[1]);
        const id = asked.split("/track/")[1];
        return { ok: true, status: 200, json: async () => ({ trackId: id, url: url(id), title: id === TRACK ? "Thriller" : "Beat It", thumbnailUrl: null }) };
      }
      if (init?.method === "PATCH" && patch.status === 200) {
        const sent = JSON.parse(init.body!).spotifyUrl as string | null;
        const id = sent ? sent.split("/track/")[1] : null;
        linked = { ready: true, trackId: id, url: id ? url(id) : null };
      }
      return { ok: patch.status < 400, status: patch.status, json: async () => patch.body };
    });
    global.fetch = fetchMock as never;
    return fetchMock;
  }
  const field = () => screen.getByLabelText("Spotify link");
  const save = () => screen.getByRole("button", { name: "Save" });
  const patches = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH");

  it("shows the linked track by name, with Save held until the link changes", async () => {
    spotifyApi({ spotify: { ready: true, trackId: TRACK, url: url(TRACK) } });
    setup();
    expect(await screen.findByTestId("spotify-link-found")).toHaveTextContent("Thriller");
    expect(field()).toHaveValue(url(TRACK));
    expect(save()).toBeDisabled();
    // The same track with a share suffix is the same link.
    fireEvent.change(field(), { target: { value: `${url(TRACK)}?si=abc` } });
    expect(save()).toBeDisabled();
  });

  it("saves a new link, and says how it is read", async () => {
    const fetchMock = spotifyApi();
    setup();
    await screen.findByLabelText("Spotify link");
    fireEvent.change(field(), { target: { value: url(OTHER) } });
    fireEvent.blur(field());
    expect(await screen.findByTestId("spotify-link-found")).toHaveTextContent("Beat It");
    fireEvent.click(save());
    expect(await screen.findByText("Saved. Its play count is read once a day.")).toBeInTheDocument();
    const [href, init] = patches(fetchMock)[0];
    expect(href).toBe("/api/campaigns/camp-1");
    expect(JSON.parse(init.body)).toEqual({ spotifyUrl: url(OTHER) });
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it("removes the link when the field is emptied", async () => {
    const fetchMock = spotifyApi({ spotify: { ready: true, trackId: TRACK, url: url(TRACK) } });
    setup();
    await screen.findByTestId("spotify-link-found");
    fireEvent.change(field(), { target: { value: "" } });
    expect(save()).not.toBeDisabled();
    fireEvent.click(save());
    expect(await screen.findByText("Removed. The track is matched by title and artist again.")).toBeInTheDocument();
    expect(JSON.parse(patches(fetchMock)[0][1].body)).toEqual({ spotifyUrl: null });
  });

  it("leaves an artist link out and goes back to the saved track", async () => {
    const fetchMock = spotifyApi({ spotify: { ready: true, trackId: TRACK, url: url(TRACK) } });
    setup();
    await screen.findByTestId("spotify-link-found");
    fireEvent.change(field(), { target: { value: `https://open.spotify.com/artist/${TRACK}` } });
    fireEvent.blur(field());
    expect(await screen.findByTestId("audio-link-not-added")).toHaveTextContent(
      "Not added. That's an artist link. Open the song and copy its link. The link already in this field stays."
    );
    expect(field()).toHaveValue(url(TRACK));
    expect(await screen.findByTestId("spotify-link-found")).toHaveTextContent("Thriller");
    expect(save()).toBeDisabled();
    expect(patches(fetchMock)).toHaveLength(0);
  });

  it("hands a TikTok sound pasted here to the TikTok section", async () => {
    spotifyApi();
    setup();
    await screen.findByLabelText("Spotify link");
    fireEvent.change(field(), { target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" } });
    fireEvent.blur(field());
    expect(field()).toHaveValue("");
    await waitFor(() =>
      expect(screen.getByLabelText("TikTok sound link")).toHaveValue("https://www.tiktok.com/music/Roots-7208251152978151425")
    );
    expect(within(section("Add TikTok sound")).getByTestId("audio-link-moved")).toHaveTextContent(
      "Moved here from Spotify link."
    );
  });

  it("shows the server's refusal beside the field", async () => {
    spotifyApi({
      patch: { status: 503, body: { error: "spotify_link_unavailable", message: "Spotify links can't be saved yet. Try again later." } },
    });
    setup();
    await screen.findByLabelText("Spotify link");
    fireEvent.change(field(), { target: { value: url(OTHER) } });
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Spotify links can't be saved yet. Try again later.");
  });

  it("cannot be edited while the database cannot store a link, and says so", async () => {
    spotifyApi({ spotify: { ready: false, trackId: null, url: null } });
    setup();
    await waitFor(() => expect(field()).toBeDisabled());
    expect(save()).toBeDisabled();
    expect(screen.getByText("Spotify links can't be saved yet. Try again later.")).toBeInTheDocument();
  });
});
