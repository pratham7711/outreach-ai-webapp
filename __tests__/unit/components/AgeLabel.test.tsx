/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { AgeLabel } from "@/components/ds/AgeLabel";
import PostStatusChip from "@/components/posts/PostStatusChip";

const NOW = new Date("2026-10-02T12:00:00Z");
const ago = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("AgeLabel", () => {
  it("shows the age, with the absolute time and source in the tooltip", () => {
    const { container } = render(<AgeLabel at={ago(3)} field="profile" source="Profile read" now={NOW} />);
    const label = container.querySelector("[data-age]")!;
    expect(label.getAttribute("data-age")).toBe("fresh");
    expect(label.getAttribute("title")).toBe("Read 2 Oct 2026, 09:00 UTC · Profile read");
    expect(screen.getByText("3h ago")).toBeInTheDocument();
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("adds a Stale chip past twice the target", () => {
    const { container } = render(<AgeLabel at={ago(49)} field="profile" now={NOW} />);
    expect(container.querySelector("[data-age]")!.getAttribute("data-age")).toBe("stale");
    expect(screen.getByText("Stale")).toBeInTheDocument();
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });

  it("never calls an untracked post stale", () => {
    render(<AgeLabel at={ago(24 * 90)} field="post" ctx={{ tracked: false }} now={NOW} />);
    expect(screen.queryByText("Stale")).toBeNull();
  });

  it("says so when there is no time, or renders nothing when asked", () => {
    const { container, rerender } = render(<AgeLabel at={null} field="profile" now={NOW} />);
    expect(screen.getByText("not read yet")).toBeInTheDocument();
    rerender(<AgeLabel at={null} field="profile" never="time not recorded" now={NOW} />);
    expect(screen.getByText("time not recorded")).toBeInTheDocument();
    rerender(<AgeLabel at={null} field="profile" never={null} now={NOW} />);
    expect(container.querySelector("[data-age]")).toBeNull();
  });

  it("will not vouch for a future time", () => {
    render(<AgeLabel at={new Date(NOW.getTime() + 60 * 60 * 1000)} field="profile" now={NOW} />);
    expect(screen.getByText("time unknown")).toBeInTheDocument();
  });

  it("puts a prefix before the age", () => {
    render(<AgeLabel at={ago(2)} field="post" prefix="Updated" now={NOW} />);
    expect(screen.getByText("Updated 2h ago")).toBeInTheDocument();
  });
});

describe("PostStatusChip", () => {
  it("draws nothing for a live post unless asked, then a quiet Live", () => {
    const live = { kind: "live" as const, label: "Live", detail: "Live: read 3 Sep 2026." };
    const { container, rerender } = render(<PostStatusChip status={live} />);
    expect(container.innerHTML).toBe("");
    rerender(<PostStatusChip status={live} showLive />);
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("draws the warning pill with the resolver's words for anything else", () => {
    render(<PostStatusChip status={{ kind: "hidden", label: "Hidden", detail: "Hidden: the creator set it to Only me." }} />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Hidden");
    expect(pill).toHaveAttribute("aria-label", "Hidden: the creator set it to Only me.");
    expect(pill.closest("[data-post-status]")!.getAttribute("data-post-status")).toBe("hidden");
  });
});
