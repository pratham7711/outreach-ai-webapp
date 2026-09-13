/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
   says whether the campaign already has audio, the resolve that previews a
   link, and the PATCH that attaches it. */
function mockApi({ audio = null as any, resolve = {} as any, patchOk = true } = {}) {
  global.fetch = jest.fn(async (url: any, init?: any) => {
    const href = String(url);
    if (href.includes("/performance")) {
      return { ok: true, json: async () => ({ audio }) } as any;
    }
    if (href.includes("/audio/resolve")) {
      return {
        ok: resolve.ok !== false,
        json: async () =>
          resolve.ok === false
            ? { message: resolve.message ?? "no" }
            : { platform: "TIKTOK", soundId: "7208251152978151425", provisionalTitle: "Roots" },
      } as any;
    }
    // the PATCH
    return { ok: patchOk, json: async () => ({ id: "camp-1" }) } as any;
  }) as any;
  return global.fetch as jest.Mock;
}

const setup = () => render(<CampaignAudioSetup campaignId="camp-1" />);

describe("CampaignAudioSetup — a campaign with no sound", () => {
  it("offers to add one, and says what tracking buys", async () => {
    mockApi();
    setup();
    expect(await screen.findByRole("button", { name: /add audio/i })).toBeInTheDocument();
    expect(screen.getByText(/thumbnail from its cover art/i)).toBeInTheDocument();
  });

  it("refuses a link to a post before spending a round trip on it", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add audio/i }));
    fireEvent.change(screen.getByLabelText("Sound link"), {
      target: { value: "https://www.tiktok.com/@someone/video/123" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/link to a post, not its sound/i);
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    // Nothing beyond the initial performance read was requested.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("resolve"))).toHaveLength(0);
  });

  it("shows what the link resolved to before anything is written", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add audio/i }));
    fireEvent.change(screen.getByLabelText("Sound link"), {
      target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText(/STEP 2 OF 3/)).toBeInTheDocument();
    expect(screen.getByText("Roots")).toBeInTheDocument();
    expect(screen.getByText(/7208251152978151425/)).toBeInTheDocument();
    /* The distinction the stepper exists for: a shortened link is opaque, so
       the operator confirms the sound rather than the URL. */
    expect(screen.getByText(/Nothing has been attached yet/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH")).toHaveLength(0);
  });

  it("attaches only on the confirm step", async () => {
    const fetchMock = mockApi();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /add audio/i }));
    fireEvent.change(screen.getByLabelText("Sound link"), {
      target: { value: "https://www.tiktok.com/music/Roots-7208251152978151425" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => expect(screen.getByText(/STEP 3 OF 3/)).toBeInTheDocument());
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(JSON.parse(patch![1].body)).toEqual({
      audioUrl: "https://www.tiktok.com/music/Roots-7208251152978151425",
    });
  });
});

describe("CampaignAudioSetup — a campaign that already has one", () => {
  const audio = { title: "Roots", artist: "Jamie MacDonald", coverUrl: "https://cdn/c.jpg", uses: 222 };

  it("shows the sound, its cover and its usage, with a way to change or remove it", async () => {
    mockApi({ audio });
    setup();
    expect(await screen.findByText("Roots")).toBeInTheDocument();
    expect(screen.getByText(/Jamie MacDonald · 222 videos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("detaches the campaign from the sound without deleting the sound", async () => {
    const fetchMock = mockApi({ audio });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: /remove/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /add audio/i })).toBeInTheDocument());
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH");
    /* songId: null, never a DELETE. Other campaigns may read the same tracker
       and the usage history belongs to the sound. */
    expect(JSON.parse(patch![1].body)).toEqual({ songId: null });
  });
});
