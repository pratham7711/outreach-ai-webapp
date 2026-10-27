/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, within, act } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Modal: ({ children, footer, title }: any) => (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ),
    /* Mirrors the real Input's error contract. The stub used to drop `error`
       on the floor, so a field that states its own problem rendered nothing
       here and the payout assertions below could not see a message the app
       does show. */
    Input: ({ label, value, onChange, onBlur, onPaste, placeholder, type, error, required, "aria-invalid": ariaInvalid }: any) => {
      const id = `mock-input-${label}`;
      return (
        <>
          <input
            aria-label={label}
            id={id}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            onPaste={onPaste}
            placeholder={placeholder}
            type={type}
            required={required}
            aria-invalid={ariaInvalid ?? Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <span id={`${id}-error`} role="alert">
              {error}
            </span>
          )}
        </>
      );
    },
    Badge: ({ children }: any) => <span>{children}</span>,
  }),
  { virtual: true }
);

jest.mock("@/components/ds", () => ({
  Button: ({ children, loading, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Dropdown: ({ ariaLabel, value, onChange, options }: any) => (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const mockToastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a), success: jest.fn() } }));

/* jest.setup's router has no refresh(), which the wizard calls after a create. */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

import CampaignWizard from "@/components/modals/CampaignWizard";

function openWizard(props: { defaultCurrency?: string } = {}) {
  render(<CampaignWizard clients={[]} onClose={jest.fn()} {...props} />);
}
const create = () => screen.getByText("Create Campaign").closest("button")!;
const name = (value: string) => fireEvent.change(screen.getByLabelText("Campaign Name"), { target: { value } });

describe("CampaignWizard — currency", () => {
  /* The wizard hardcoded "USD", so an agency billing in INR corrected the
     currency on every single campaign it created. */
  it("opens on the org's own currency", () => {
    openWizard({ defaultCurrency: "INR" });
    expect(screen.getByLabelText("Currency")).toHaveValue("INR");
  });

  it("falls back to USD when the org currency is absent or not one we offer", () => {
    openWizard({ defaultCurrency: "XYZ" });
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });
});

/**
 * One step since October 2026: the payout step left with the payments surface.
 * The trap it had to avoid -- a hidden payout model defaulting to per-view,
 * which demands a rate and a cap, leaving Create Campaign disabled with no
 * field on screen to fix it -- is what these pin.
 */
describe("CampaignWizard — a single step with no payout", () => {
  it("has no Next and no payout fields", () => {
    openWizard();
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Payout model" })).toBeNull();
    expect(screen.queryByLabelText("Rate per 1K Views")).toBeNull();
    expect(screen.queryByLabelText("Cap Amount")).toBeNull();
    expect(screen.queryByText(/Step \d of/)).toBeNull();
  });

  it("holds Create Campaign only until the campaign has a name", () => {
    openWizard();
    expect(create()).toBeDisabled();
    name("Summer Drop");
    expect(create()).not.toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates a negotiated, budget-based campaign with the budget, currency and approval mode given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-1" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard({ defaultCurrency: "INR" });
    name("Summer Drop");
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("radio", { name: /Auto-Approved/ }));
    await act(async () => {
      fireEvent.click(create());
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/campaigns");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      title: "Summer Drop",
      campaignType: "BUDGET_BASED",
      budget: 5000,
      currency: "INR",
      postApprovalMode: "AUTO_APPROVED",
      typeConfig: { model: "negotiated", currency: "INR", allowCounterOffer: true },
    });
  });

  /* "Who handles payment?" went earlier: payment is always self-managed, so
     the question offered a service we do not run. */
  it("does not ask who handles payment", () => {
    openWizard();
    expect(screen.queryByRole("radiogroup", { name: "Who handles payment?" })).toBeNull();
    expect(screen.queryByText("Payment Release Trigger")).toBeNull();
    expect(screen.queryByText(/open enrollment/i)).toBeNull();
  });
});

/**
 * The approval cards were bare <div onClick> -- role null, tabIndex -1, so the
 * mode could only be changed with a mouse. They now use the same radio group
 * the payout model used.
 */
describe("CampaignWizard — post approval mode is a radio group", () => {
  const group = () => screen.getByRole("radiogroup", { name: "Post approval mode" });
  const radios = () => within(group()).getAllByRole("radio");

  it("offers Manual Review and Auto-Approved, Manual checked", () => {
    openWizard();
    expect(radios().map((r) => [r.textContent?.startsWith("Manual") ? "manual" : "auto", r.getAttribute("aria-checked")])).toEqual([
      ["manual", "true"],
      ["auto", "false"],
    ]);
  });

  it("keeps one tab stop, on the selected card", () => {
    openWizard();
    const [first, second] = radios();
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
  });

  it("selects with the keyboard and moves with the arrows", () => {
    openWizard();
    fireEvent.keyDown(radios()[1], { key: " " });
    expect(radios()[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radios()[1], { key: "ArrowLeft" });
    expect(radios()[0]).toHaveAttribute("aria-checked", "true");
  });
});

/**
 * Walkthrough 2026-10-13 A1#22: the Budget field took "-500" and the only
 * answer was the server's bare "Invalid input". It is refused beside the field
 * now, and 0 means "no budget", sent as null like an empty field.
 */
describe("CampaignWizard — budget", () => {
  const budget = (value: string) => fireEvent.change(screen.getByLabelText("Budget"), { target: { value } });

  it("refuses a negative budget beside the field and holds Create Campaign", () => {
    openWizard();
    name("Summer Drop");
    budget("-500");
    expect(screen.getByRole("alert")).toHaveTextContent("Budget can't be negative.");
    expect(create()).toBeDisabled();
    budget("500");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).not.toBeDisabled();
  });

  it("sends a budget of 0 as no budget", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "c-1" }) });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWizard();
    name("Summer Drop");
    budget("0");
    await act(async () => {
      fireEvent.click(create());
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).budget).toBeNull();
  });
});

/**
 * Walkthrough 2026-10-13 A1#11: Import on a TikTok link whose id TikTok does
 * not know showed a sound card titled from the URL slug ("WALK Test Sound").
 * The route now says whether the platform confirmed the sound, and an
 * unconfirmed one gets no card and no name.
 */
describe("CampaignWizard — checking a TikTok sound", () => {
  function importLink(response: Record<string, unknown>) {
    (global as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => response });
    openWizard();
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
    fireEvent.change(screen.getByLabelText("TikTok sound"), {
      target: { value: "https://www.tiktok.com/music/WALK-Test-Sound-7400000000000000009" },
    });
  }

  it("says it could not find or verify the sound and shows no made-up title", async () => {
    importLink({ platform: "TIKTOK", soundId: "7400000000000000009", verified: false, provisionalTitle: null });
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't find or verify this sound on TikTok.");
    expect(screen.queryByText(/WALK Test Sound/)).toBeNull();
    expect(screen.queryByText(/^Sound 7400000000000000009$/)).toBeNull();
  });

  it("still shows the card for a sound TikTok answered for", async () => {
    importLink({
      platform: "TIKTOK",
      soundId: "7400000000000000009",
      verified: true,
      provisionalTitle: "Real Sound",
      artist: "Real Artist",
      coverImageUrl: "https://example.com/cover.jpg",
      usesCount: 12,
    });
    expect(screen.queryByText("Import")).toBeNull();
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(screen.getByText("Real Sound")).toBeInTheDocument();
    expect(screen.getByText(/12 videos/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves a post link out with the way to its sound, asks nobody, and keeps Create open", async () => {
    importLink({});
    name("Summer Drop");
    const fetchMock = global.fetch as jest.Mock;
    fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: "https://www.tiktok.com/@someone/video/7400000000000000001" } });
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(screen.getByLabelText("TikTok sound")).toHaveValue("");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent("Not added. That's a link to a post, not its sound.");
    expect(screen.getByTestId("audio-link-not-added")).not.toHaveTextContent("stays");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create()).not.toBeDisabled();
  });

  it("offers to ask TikTok again when it did not answer", async () => {
    importLink({ platform: "TIKTOK", soundId: "7400000000000000009", verified: false, provisionalTitle: null });
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ platform: "TIKTOK", soundId: "7400000000000000009", verified: true, provisionalTitle: "Real Sound", coverImageUrl: "https://example.com/c.jpg", usesCount: 12 }),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Real Sound")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves out a link from another site", async () => {
    importLink({});
    await act(async () => {
      fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: "https://www.youtube.com/watch?v=abc" } });
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(screen.getByLabelText("TikTok sound")).toHaveValue("");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent("Not added. That isn't a TikTok, Instagram or Spotify link.");
  });
});

/**
 * The song's Spotify link, under the sound links. Optional; checked on blur or
 * paste against GET /api/songs/spotify-check; a link that is not a track, or
 * that Spotify has no track for, holds Create back.
 */
describe("CampaignWizard — Spotify link", () => {
  const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
  const trackUrl = `https://open.spotify.com/track/${TRACK}`;
  const spotifyField = () => screen.getByLabelText("Spotify link");

  function api({ check, created = { id: "c-1" } }: { check?: { status: number; body: unknown }; created?: unknown } = {}) {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url).startsWith("/api/songs/spotify-check")) {
        const c = check ?? { status: 200, body: { trackId: TRACK, url: trackUrl, title: "Thriller", thumbnailUrl: "https://i.scdn.co/image/ab67" } };
        return { ok: c.status < 400, status: c.status, json: async () => c.body };
      }
      return { ok: true, status: 201, json: async () => created };
    });
    (global as { fetch: unknown }).fetch = fetchMock;
    return fetchMock;
  }
  function openWithSound() {
    openWizard();
    name("Summer Drop");
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
  }

  beforeEach(() => mockToastError.mockReset());

  it("sits under the sound links, optional, with its hint", () => {
    api();
    openWithSound();
    expect(spotifyField()).toHaveAttribute("placeholder", "https://open.spotify.com/track/\u2026");
    expect(
      screen.getByText(
        "Optional. The song's Spotify track link. We read its play count once a day. Leave it empty and we match the track by title and artist."
      )
    ).toBeInTheDocument();
    expect(create()).not.toBeDisabled();
  });

  it("leaves an album link out with why, asks nobody, and keeps Create open", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: `https://open.spotify.com/album/${TRACK}` } });
    await act(async () => {
      fireEvent.blur(spotifyField());
    });
    expect(spotifyField()).toHaveValue("");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent(
      "Not added. That's an album link. Open the song and copy its link."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(create()).not.toBeDisabled();
  });

  it("checks the link when the field is left, and shows the track it names", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.blur(spotifyField());
    });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/songs/spotify-check?url=${encodeURIComponent(trackUrl)}`);
    const found = screen.getByTestId("spotify-link-found");
    expect(found).toHaveTextContent("Thriller");
    expect(found).toHaveTextContent("on Spotify");
    expect(found).toHaveAttribute("href", trackUrl);
    expect(create()).not.toBeDisabled();
  });

  it("leaves the link out when Spotify has no track there", async () => {
    api({ check: { status: 404, body: { error: "not_found", message: "Spotify has no track at that link." } } });
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    await act(async () => {
      fireEvent.blur(spotifyField());
    });
    expect(spotifyField()).toHaveValue("");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent("Not added. Spotify has no track at that link.");
    expect(create()).not.toBeDisabled();
    // Typing again clears the line: it described the link that was left out.
    fireEvent.change(spotifyField(), { target: { value: "h" } });
    expect(screen.queryByTestId("audio-link-not-added")).toBeNull();
  });

  it("holds Create while the link is being checked", async () => {
    let answer: (v: unknown) => void = () => {};
    (global as { fetch: unknown }).fetch = jest.fn(
      () => new Promise((resolve) => (answer = resolve))
    );
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    fireEvent.blur(spotifyField());
    expect(create()).toBeDisabled();
    await act(async () => {
      answer({ ok: true, status: 200, json: async () => ({ trackId: TRACK, url: trackUrl, title: "Thriller", thumbnailUrl: null }) });
    });
    expect(create()).not.toBeDisabled();
  });

  it("says Spotify did not answer, but lets the campaign be created", async () => {
    api({ check: { status: 502, body: { error: "spotify_unavailable", message: "Spotify didn't answer. Try again in a moment." } } });
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    await act(async () => {
      fireEvent.blur(spotifyField());
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Spotify didn't answer. Try again in a moment.");
    expect(create()).not.toBeDisabled();
  });

  it("sends the link with the campaign", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: `  ${trackUrl}  ` } });
    await act(async () => {
      fireEvent.click(create());
    });
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/campaigns")!;
    expect(JSON.parse((call as unknown as [string, { body: string }])[1].body).spotifyUrl).toBe(trackUrl);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("sends no link once the sound box is unticked", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
    await act(async () => {
      fireEvent.click(create());
    });
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/campaigns")!;
    expect(JSON.parse((call as unknown as [string, { body: string }])[1].body)).not.toHaveProperty("spotifyUrl");
  });

  it("says so when the campaign was created but the link was not kept", async () => {
    api({ created: { id: "c-1", spotifyLinked: false } });
    openWithSound();
    fireEvent.change(spotifyField(), { target: { value: trackUrl } });
    await act(async () => {
      fireEvent.click(create());
    });
    expect(mockToastError).toHaveBeenCalledWith(
      "Campaign created, but the Spotify link didn't save. Add it from the campaign's audio settings."
    );
  });
});

/**
 * The song's Instagram audio, beside its TikTok sound. Optional; checked on
 * blur or paste through POST /api/campaigns/audio/resolve, which reads the
 * audio page. No such audio, or original audio with no count, holds Create
 * back; Instagram not answering does not.
 */
describe("CampaignWizard — Instagram audio", () => {
  const IG_ID = "1180417966306130";
  const igUrl = `https://www.instagram.com/reels/audio/${IG_ID}/`;
  const igField = () => screen.getByLabelText("Instagram audio");
  const found = {
    platform: "INSTAGRAM",
    soundId: IG_ID,
    verified: true,
    provisionalTitle: "Runaway",
    artist: "AURORA",
    coverImageUrl: "https://example.com/ig.jpg",
    usesCount: 2_000_000,
    usesRounded: true,
  };

  function api({ resolve = { status: 200, body: found as unknown }, created = { id: "c-1" } as unknown } = {}) {
    const fetchMock = jest.fn(async (url: string) => {
      if (String(url) === "/api/campaigns/audio/resolve") {
        return { ok: resolve.status < 400, status: resolve.status, json: async () => resolve.body };
      }
      return { ok: true, status: 201, json: async () => created };
    });
    (global as { fetch: unknown }).fetch = fetchMock;
    return fetchMock;
  }
  function openWithSound() {
    openWizard();
    name("Summer Drop");
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
  }
  const sent = (fetchMock: jest.Mock) => {
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/campaigns")!;
    return JSON.parse((call as unknown as [string, { body: string }])[1].body);
  };

  beforeEach(() => mockToastError.mockReset());

  it("sits between the TikTok sound and the Spotify link, optional", () => {
    api();
    openWithSound();
    const fields = screen.getAllByRole("textbox").map((el) => el.getAttribute("aria-label"));
    expect(fields.indexOf("TikTok sound")).toBeLessThan(fields.indexOf("Instagram audio"));
    expect(fields.indexOf("Instagram audio")).toBeLessThan(fields.indexOf("Spotify link"));
    expect(screen.getByText(/Licensed music only: Instagram shows no count for original audio\./)).toBeInTheDocument();
    expect(create()).not.toBeDisabled();
  });

  it("moves a TikTok sound put here to the TikTok field, and checks it there", async () => {
    const tiktokUrl = "https://www.tiktok.com/music/Roots-7208251152978151425";
    const fetchMock = api({ resolve: { status: 200, body: { platform: "TIKTOK", soundId: "7208251152978151425", verified: true, provisionalTitle: "Roots", coverImageUrl: "https://example.com/roots.jpg", usesCount: 222 } } });
    openWithSound();
    fireEvent.change(igField(), { target: { value: tiktokUrl } });
    await act(async () => {
      fireEvent.blur(igField());
    });
    expect(igField()).toHaveValue("");
    expect(screen.getByLabelText("TikTok sound")).toHaveValue(tiktokUrl);
    expect(screen.getByTestId("audio-link-moved")).toHaveTextContent("Moved here from Instagram audio.");
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ url: tiktokUrl });
    expect(screen.getByText("Roots")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).not.toBeDisabled();
  });

  it("checks the audio when the field is left, and shows what Instagram says about it", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(igField(), { target: { value: igUrl } });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.blur(igField());
    });
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ url: igUrl });
    const row = screen.getByTestId("instagram-audio-found");
    expect(row).toHaveTextContent("Runaway");
    expect(row).toHaveTextContent("AURORA · ≈2M reels");
    expect(create()).not.toBeDisabled();
  });

  it("leaves original audio out, says why in a line, and keeps Create open", async () => {
    api({ resolve: { status: 400, body: { error: "instagram_audio_no_count", message: "Instagram doesn't publish a use count for that audio." } } });
    openWithSound();
    fireEvent.change(igField(), { target: { value: igUrl } });
    await act(async () => {
      fireEvent.blur(igField());
    });
    expect(igField()).toHaveValue("");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent(
      "Not added. That's original audio. Instagram doesn't show how many reels use original audio, so there's nothing to track."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).not.toBeDisabled();
  });

  it("says Instagram did not answer, but lets the campaign be created", async () => {
    api({ resolve: { status: 200, body: { ...found, verified: null, provisionalTitle: null, usesCount: null } } });
    openWithSound();
    fireEvent.change(igField(), { target: { value: igUrl } });
    await act(async () => {
      fireEvent.blur(igField());
    });
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't reach Instagram to check that audio just now.");
    expect(create()).not.toBeDisabled();
  });

  it("sends the audio with the campaign, and takes its cover when there is no TikTok one", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(igField(), { target: { value: `  ${igUrl}  ` } });
    await act(async () => {
      fireEvent.blur(igField());
    });
    await act(async () => {
      fireEvent.click(create());
    });
    const body = sent(fetchMock);
    expect(body.instagramAudioUrl).toBe(igUrl);
    expect(body).not.toHaveProperty("audioUrl");
    expect(body.thumbnailUrl).toBe("https://example.com/ig.jpg");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("moves an Instagram audio put in the TikTok field to its own, and checks it there", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: igUrl } });
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(screen.getByLabelText("TikTok sound")).toHaveValue("");
    expect(igField()).toHaveValue(igUrl);
    expect(screen.getByTestId("audio-link-moved")).toHaveTextContent("Moved here from TikTok sound.");
    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/audio/resolve", expect.anything());
    expect(screen.getByTestId("instagram-audio-found")).toHaveTextContent("Runaway");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(create()).not.toBeDisabled();
  });

  const paste = async (el: HTMLElement, text: string) => {
    await act(async () => {
      fireEvent.paste(el, { clipboardData: { getData: () => text } });
    });
  };

  it("sends a pasted link to its own field and leaves the field it was pasted into as it was", async () => {
    const tiktokUrl = "https://www.tiktok.com/music/Roots-7208251152978151425";
    api();
    openWithSound();
    fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: tiktokUrl } });
    await paste(screen.getByLabelText("TikTok sound"), igUrl);
    expect(screen.getByLabelText("TikTok sound")).toHaveValue(tiktokUrl);
    expect(igField()).toHaveValue(igUrl);
    expect(screen.getByTestId("instagram-audio-found")).toHaveTextContent("Runaway");
    expect(screen.getByTestId("audio-link-moved")).toHaveTextContent("Moved here from TikTok sound.");
  });

  it("puts the link that was there back when a pasted one is left out", async () => {
    const original = "https://www.instagram.com/reels/audio/932615931412635/";
    const fetchMock = jest.fn(async (url: string, init?: { body?: string }) => {
      if (String(url) === "/api/campaigns/audio/resolve") {
        const asked = JSON.parse(init?.body ?? "{}").url;
        return asked === original
          ? { ok: false, status: 400, json: async () => ({ error: "instagram_audio_no_count", message: "x" }) }
          : { ok: true, status: 200, json: async () => found };
      }
      return { ok: true, status: 201, json: async () => ({ id: "c-1" }) };
    });
    (global as { fetch: unknown }).fetch = fetchMock;
    openWithSound();
    await paste(igField(), igUrl);
    expect(screen.getByTestId("instagram-audio-found")).toHaveTextContent("Runaway");

    await paste(igField(), original);
    expect(igField()).toHaveValue(igUrl);
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent("Not added. That's original audio.");
    expect(screen.getByTestId("audio-link-not-added")).toHaveTextContent(/The link already in this field stays\.$/);
    expect(screen.getByTestId("instagram-audio-found")).toHaveTextContent("Runaway");
    expect(create()).not.toBeDisabled();
    // Put back with what was found for it, not asked about again.
    expect(fetchMock.mock.calls.filter((c) => c[0] === "/api/campaigns/audio/resolve")).toHaveLength(2);
  });

  it("pastes text that is not a link as usual", async () => {
    const fetchMock = api();
    openWithSound();
    await paste(igField(), "just some words");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("audio-link-not-added")).toBeNull();
  });

  it("takes the place of a link already in the field it moves to, and says so", async () => {
    api();
    openWithSound();
    fireEvent.change(igField(), { target: { value: "https://www.instagram.com/reels/audio/932615931412635/" } });
    fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: igUrl } });
    await act(async () => {
      fireEvent.blur(screen.getByLabelText("TikTok sound"));
    });
    expect(igField()).toHaveValue(igUrl);
    expect(screen.getByTestId("audio-link-moved")).toHaveTextContent(
      "Moved here from TikTok sound, in place of the link that was here."
    );
  });

  it("says so when the campaign was created but the Instagram audio was not kept", async () => {
    api({ created: { id: "c-1", instagramLinked: false } });
    openWithSound();
    fireEvent.change(screen.getByLabelText("TikTok sound"), { target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" } });
    fireEvent.change(igField(), { target: { value: igUrl } });
    await act(async () => {
      fireEvent.click(create());
    });
    expect(mockToastError).toHaveBeenCalledWith(
      "Campaign created, but the Instagram audio didn't save beside the TikTok sound. Add it from the campaign's audio settings."
    );
  });

  it("sends no Instagram audio once the sound box is unticked", async () => {
    const fetchMock = api();
    openWithSound();
    fireEvent.change(igField(), { target: { value: igUrl } });
    fireEvent.click(screen.getByText("This campaign promotes a sound"));
    await act(async () => {
      fireEvent.click(create());
    });
    expect(sent(fetchMock)).not.toHaveProperty("instagramAudioUrl");
  });
});
