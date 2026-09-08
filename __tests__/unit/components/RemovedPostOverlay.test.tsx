/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import { REMOVED_FETCH_REASON } from "@/lib/postRemoval";

/* The pill is the only place the app states "this post is gone", so what it
   says and what it says it on behalf of both matter: the wording has to be the
   same everywhere, and the timestamp has to be the one we measured. */

describe("RemovedPostOverlay", () => {
  it("carries the shared wording; compact shows the noun phrase and keeps the sentence accessible", () => {
    const { rerender } = render(<RemovedPostOverlay />);
    expect(screen.getByText("Post unavailable — it may have been deleted")).toBeInTheDocument();
    rerender(<RemovedPostOverlay variant="inline" compact />);
    expect(screen.getByText("Post unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Post unavailable — it may have been deleted")).toBeNull();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Post unavailable — it may have been deleted");
  });

  it("puts the last check in the accessible name, not the visible text", () => {
    const at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(<RemovedPostOverlay note={{ reason: REMOVED_FETCH_REASON, at, via: "cron" }} />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveAttribute(
      "aria-label",
      "Post unavailable — it may have been deleted. Last checked 2h ago."
    );
    expect(pill.title).toBe(pill.getAttribute("aria-label"));
    expect(pill.textContent).not.toContain("Last checked");
  });

  it("omits the sentence entirely when there is no timestamp to stand behind", () => {
    render(<RemovedPostOverlay note={null} />);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Post unavailable — it may have been deleted"
    );
  });

  it("only takes itself out of flow in the overlay variant", () => {
    // The grid card positions this over the thumbnail; the list row and the post
    // header have no image to sit on and need it inline.
    const { rerender } = render(<RemovedPostOverlay />);
    expect(screen.getByRole("status")).toHaveStyle({ position: "absolute" });
    rerender(<RemovedPostOverlay variant="inline" />);
    expect(screen.getByRole("status")).toHaveStyle({ position: "static" });
  });
});
