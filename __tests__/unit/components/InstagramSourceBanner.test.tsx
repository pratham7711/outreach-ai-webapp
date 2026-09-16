/**
 * @jest-environment jsdom
 *
 * The banner is the only place a non-engineer learns that Instagram view counts
 * have stopped moving, so what it says has to be true.
 *
 * It previously said "the Instagram data connection expired on <date>" for
 * every failure, where <date> was the moment the probe ran -- today, always --
 * printed as the day the credential died. It also collapsed three unrelated
 * situations into that one sentence: a connection never set up, a connection
 * Meta refused, and our own failure to reach Meta at all. Only the middle one
 * is something an admin can act on. Each branch is pinned here.
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@/lib/api/client", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

import { apiFetch } from "@/lib/api/client";
import { InstagramSourceBanner } from "@/components/integrations/InstagramSourceBanner";

const mockFetch = apiFetch as jest.Mock;
const CHECKED = "2026-09-16T09:00:00.000Z";

function answer(instagram: unknown, instagramFallback: unknown = null) {
  mockFetch.mockResolvedValue({ instagram, instagramFallback });
}

const DOWN = { ok: false, code: 190, reason: "token expired or revoked", checkedAt: CHECKED };

beforeEach(() => mockFetch.mockReset());

describe("InstagramSourceBanner", () => {
  it("says nothing at all while the source is healthy", async () => {
    answer({ ok: true, igAccounts: 2, checkedAt: CHECKED, expiresInDays: 45, renewalError: null });
    const { container } = render(<InstagramSourceBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // A banner that says "all fine" is a banner people learn to scroll past.
    expect(container).toBeEmptyDOMElement();
  });

  it("warns before the outage when a working token is nearly out of time", async () => {
    /* The whole point of moving this credential into the database: the old
       failure was only ever visible after views had already stopped. */
    answer({ ok: true, igAccounts: 2, checkedAt: CHECKED, expiresInDays: 5, renewalError: null });
    render(<InstagramSourceBanner />);
    expect(await screen.findByText(/stop refreshing in 5 days/i)).toBeInTheDocument();
    expect(screen.getByText(/still updating for now/i)).toBeInTheDocument();
  });

  it("carries the reason renewal is not happening", async () => {
    answer({
      ok: true,
      igAccounts: 2,
      checkedAt: CHECKED,
      expiresInDays: 1,
      renewalError: "Meta refused the exchange",
    });
    render(<InstagramSourceBanner />);
    expect(await screen.findByText(/stop refreshing in 1 day\b/i)).toBeInTheDocument();
    expect(screen.getByText(/Meta refused the exchange/)).toBeInTheDocument();
  });

  it("stays quiet for a healthy token with no expiry to report", async () => {
    // An env-var token has an expiry; we simply have no way to ask what it is.
    // Guessing one here would put a countdown on the page that means nothing.
    answer({ ok: true, igAccounts: 2, checkedAt: CHECKED, expiresInDays: null, renewalError: null });
    const { container } = render(<InstagramSourceBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("does not send anyone to reconnect a connection that was never set up", async () => {
    answer({ ok: false, code: null, reason: "not configured", checkedAt: CHECKED });
    render(<InstagramSourceBanner />);
    expect(await screen.findByText(/no Instagram data connection is set up/i)).toBeInTheDocument();
    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
  });

  it("separates our own network failure from a refused credential", async () => {
    answer({
      ok: false,
      code: null,
      reason: "could not reach Instagram (The operation was aborted due to timeout)",
      checkedAt: CHECKED,
    });
    render(<InstagramSourceBanner />);
    expect(await screen.findByText(/may be out of date/i)).toBeInTheDocument();
    expect(screen.getByText(/clears on its own/i)).toBeInTheDocument();
    expect(screen.queryByText(/reconnect/i)).not.toBeInTheDocument();
  });

  it("asks for a reconnect only when Meta actually refused the credential", async () => {
    answer({ ok: false, code: 190, reason: "token expired or revoked", checkedAt: CHECKED });
    render(<InstagramSourceBanner />);
    expect(await screen.findByText(/are not refreshing/i)).toBeInTheDocument();
    expect(screen.getByText(/Ask your admin to reconnect/i)).toBeInTheDocument();
  });

  it("never prints the probe time as an expiry date", async () => {
    /* The bug this suite exists for. checkedAt is when we looked, and the
       sentence must say so. */
    answer({ ok: false, code: 190, reason: "token expired or revoked", checkedAt: CHECKED });
    const { container } = render(<InstagramSourceBanner />);
    await screen.findByText(/are not refreshing/i);
    expect(container.textContent).toMatch(/when we checked on/i);
    expect(container.textContent).not.toMatch(/expired on/i);
  });

  describe("what it says is still updating", () => {
    /* The claim this suite now exists for. Every failure branch used to end
       "Likes and comments still update." -- written when the public embed
       served them, still on the screen after it stopped. Measured 2026-09-17:
       150 production Instagram posts re-read over 7 days, zero like counts
       moved. The sentence is now whatever the fallback probe came back with. */
    it("says likes and comments stopped too when the fallback is closed", async () => {
      answer(DOWN, {
        serving: false,
        state: "closed",
        reason: "Instagram no longer publishes post figures on its public embed",
        checkedAt: CHECKED,
      });
      const { container } = render(<InstagramSourceBanner />);
      expect(await screen.findByText(/Instagram numbers are not refreshing/i)).toBeInTheDocument();
      expect(container.textContent).toMatch(/Likes and comments have stopped too/i);
      expect(container.textContent).toMatch(/no longer publishes post figures/i);
      expect(container.textContent).not.toMatch(/Likes and comments still update/i);
    });

    it("still says so when the fallback is genuinely serving", async () => {
      // Not a one-way change: if the embed answers again, the old sentence is
      // true again and should come back on its own.
      answer(DOWN, {
        serving: true,
        state: "serving",
        reason: "the public Instagram embed is serving post data",
        checkedAt: CHECKED,
      });
      const { container } = render(<InstagramSourceBanner />);
      expect(await screen.findByText(/Instagram views are not refreshing/i)).toBeInTheDocument();
      expect(container.textContent).toMatch(/Likes and comments still update/i);
    });

    it("claims nothing when nobody probed the fallback", async () => {
      /* The route only probes once the official source is down and only when
         the org has an Instagram post to probe with. An unprobed fallback is
         not a working one, and must not be described as either. */
      answer(DOWN);
      const { container } = render(<InstagramSourceBanner />);
      await screen.findByText(/are not refreshing/i);
      expect(container.textContent).toMatch(/only for creators who connected their own Instagram/i);
      expect(container.textContent).not.toMatch(/Likes and comments still update/i);
      expect(container.textContent).not.toMatch(/have stopped too/i);
    });
  });

  it("renders nothing when the health check itself fails", async () => {
    // Otherwise every lapsed session puts a warning on the page.
    mockFetch.mockRejectedValue(new Error("401"));
    const { container } = render(<InstagramSourceBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
