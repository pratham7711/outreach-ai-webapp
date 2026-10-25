/**
 * @jest-environment jsdom
 */
/**
 * The agency's creator page carries two Instagram cards. Neither may appear
 * on a creator it has nothing for: not while its read is still out, not for a
 * creator who connected no Instagram account, and not in a workspace that has
 * not connected an Instagram account of its own. A page for such a creator
 * looks exactly as it did before the cards existed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import InstagramDiscoveryPanel from "@/components/creators/InstagramDiscoveryPanel";
import InstagramInsightsPanel from "@/components/insights/InstagramInsightsPanel";

const realFetch = global.fetch;

/** Answers every fetch with `body`, or, held, never answers: the read stays out. */
function answer(status: number, body: unknown, { held = false } = {}) {
  global.fetch = jest.fn(() =>
    held ? new Promise<Response>(() => {}) : Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response),
  ) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

const insights = (props: Partial<Parameters<typeof InstagramInsightsPanel>[0]> = {}) => (
  <InstagramInsightsPanel url="/api/creators/c1/instagram-insights" hideWhen={["not_connected"]} title="Instagram account insights" {...props} />
);

describe("Public Instagram profile card", () => {
  it("draws nothing while the read is out", () => {
    answer(200, {}, { held: true });
    const { container } = render(<InstagramDiscoveryPanel creatorId="c1" />);
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing in a workspace with no Instagram account of its own", async () => {
    answer(409, { error: "no_agency_account", reason: "Connect your agency's Instagram professional account in Settings > Integrations to read public Instagram profiles." });
    const { container } = render(<InstagramDiscoveryPanel creatorId="c1" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });

  it("still asks a workspace whose own account lapsed to reconnect it", async () => {
    answer(409, { error: "agency_reauthorize", reason: "Instagram rejected your agency's connection. Reconnect it in Settings > Integrations." });
    render(<InstagramDiscoveryPanel creatorId="c1" />);
    expect(await screen.findByText(/Instagram rejected your agency's connection/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Integrations" })).toBeTruthy();
  });
});

describe("Instagram account insights card", () => {
  it("draws nothing while the read is out", () => {
    answer(200, {}, { held: true });
    const { container } = render(insights());
    expect(container.innerHTML).toBe("");
  });

  it("draws nothing for a creator who connected no Instagram account", async () => {
    answer(409, { error: "not_connected", reason: "This creator has not connected an Instagram professional account to your campaigns." });
    const { container } = render(insights());
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });

  it("draws its card once the insights arrive", async () => {
    answer(200, {
      handle: "mia",
      readAt: "2026-10-25T00:00:00Z",
      stored: false,
      account: { since: "", until: "", days: 28, totals: { reach: 900 }, followerSeries: null, demographics: { country: [], age: [], gender: [] } },
      stories: [],
    });
    render(insights());
    expect(await screen.findByRole("heading", { name: "Instagram account insights" })).toBeTruthy();
    expect(screen.getByText("Accounts reached")).toBeTruthy();
  });

  it("names a failure it was not told to hide", async () => {
    answer(502, { error: "unreadable", reason: "Instagram did not answer just now." });
    render(insights());
    expect(await screen.findByText("Instagram did not answer just now.")).toBeTruthy();
  });
});
