/**
 * @jest-environment jsdom
 */
/**
 * The practice, written down as a test.
 *
 * A list page holds a lot of state that has nothing to do with any one row --
 * a sync in flight, a refresh ticking its progress, a modal opening, every
 * keystroke in a filter box. Each of those re-renders the page, and without
 * memo it re-renders every row underneath it too, none of which changed. The
 * campaign posts grid draws 25 tiles of roughly 60 elements apiece.
 *
 * memo is easy to add and silently easy to lose: pass a new object literal or
 * an inline arrow as a prop and the component keeps rendering correctly while
 * quietly never being skipped again. So the rule is asserted rather than
 * documented -- these tests fail when a tile stops being skippable.
 */
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}), { virtual: true });

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
}));

import PostGridCard from "@/components/posts/PostGridCard";

const POST = {
  id: "p1",
  platform: "TIKTOK",
  postUrl: "https://www.tiktok.com/@someone/video/1",
  thumbnailUrl: null,
  caption: "a caption",
  postedAt: "2026-09-01T10:00:00.000Z",
  viewsCount: 1200,
  likesCount: 90,
  commentsCount: 4,
  sharesCount: 2,
  savesCount: 1,
  status: "APPROVED",
  fetchState: "LIVE",
  lastSyncedAt: "2026-09-02T10:00:00.000Z",
  creator: { name: "Someone", handle: "@someone" },
};

/* The card's renders are counted through a helper it calls exactly once per
   render. Counting by wrapping it in another component does not work: a
   component type created during a parent's render is a NEW type every time, so
   React remounts it and every memo below it is bypassed -- which is worth
   knowing, because it is the same mistake in production code. */
const renderSpy = jest.fn();
jest.mock("@/lib/posts/postDisplay", () => {
  const actual = jest.requireActual("@/lib/posts/postDisplay");
  return {
    ...actual,
    formatSince: (iso: string | null) => {
      renderSpy();
      return actual.formatSince(iso);
    },
  };
});

/** A page whose state changes for reasons that have nothing to do with a row. */
function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => setTick((t) => t + 1)}>tick</button>
      <span data-testid="tick">{tick}</span>
      <PostGridCard post={POST} campaignId="c1" />
    </div>
  );
}

describe("render discipline", () => {
  beforeEach(() => renderSpy.mockClear());

  it("a post tile is skipped when unrelated page state changes", () => {
    render(<Harness />);
    const first = renderSpy.mock.calls.length;
    expect(first).toBeGreaterThan(0);

    act(() => {
      screen.getByText("tick").click();
    });
    expect(screen.getByTestId("tick").textContent).toBe("1");
    // The page re-rendered; the tile did not.
    expect(renderSpy.mock.calls.length).toBe(first);
  });

  it("PostGridCard is a memo component, not a bare function", () => {
    // memo() returns an exotic object with a $$typeof of react.memo — a plain
    // function export would pass every other test in the suite and skip nothing.
    expect(typeof PostGridCard).toBe("object");
    expect(String((PostGridCard as any).$$typeof)).toContain("memo");
  });

  it("renders the post's own facts", () => {
    render(<PostGridCard post={POST} campaignId="c1" />);
    expect(screen.getByText("@someone")).toBeInTheDocument();
    expect(screen.getByText(/1,200 views/)).toBeInTheDocument();
  });
});
