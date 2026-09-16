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

function answer(instagram: unknown) {
  mockFetch.mockResolvedValue({ instagram });
}

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

  it("renders nothing when the health check itself fails", async () => {
    // Otherwise every lapsed session puts a warning on the page.
    mockFetch.mockRejectedValue(new Error("401"));
    const { container } = render(<InstagramSourceBanner />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
