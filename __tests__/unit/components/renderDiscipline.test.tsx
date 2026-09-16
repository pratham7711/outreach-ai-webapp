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
import { useCallback, useState } from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";

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

const noop = () => {};

/* Hoisted, because building them inside the harness would hand each tile a NEW
   post object on every render and memo would be defeated by the test rather
   than by the component -- which is the same mistake the tab avoids by keeping
   its rows behind a useMemo. */
const TWO_POSTS = [POST, { ...POST, id: "p2", creator: { name: "Other", handle: "@other" } }];

/** A page whose state changes for reasons that have nothing to do with a row. */
function Harness() {
  const [tick, setTick] = useState(0);
  return (
    <div>
      <button onClick={() => setTick((t) => t + 1)}>tick</button>
      <span data-testid="tick">{tick}</span>
      <PostGridCard
        post={POST}
        selected={false}
        selectionActive={false}
        onToggleSelect={noop}
        onOpenMenu={noop}
      />
    </div>
  );
}

/**
 * Two tiles and a real selection, which is the shape selection actually has:
 * ticking one box changes a Set held by the tab, so the tab re-renders and both
 * tiles are re-evaluated. Only the tile whose own `selected` flipped may
 * actually render -- if the other one does too, the handlers have lost their
 * identity and 25 tiles are being redrawn per click.
 */
function SelectionHarness() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const onToggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const onOpenMenu = useCallback(() => {}, []);
  return (
    <div>
      <button onClick={() => onToggleSelect("p1")}>select first</button>
      <button onClick={() => onToggleSelect("p2")}>select second</button>
      {TWO_POSTS.map((p) => (
        <PostGridCard
          key={p.id}
          post={p}
          selected={selected.has(p.id)}
          /* The real thing a selection changes for every OTHER tile: once one
             box is ticked, all the picks become visible. It is a primitive, so
             the tiles that were already showing theirs still skip. */
          selectionActive={selected.size > 0}
          onToggleSelect={onToggleSelect}
          onOpenMenu={onOpenMenu}
        />
      ))}
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
    render(
      <PostGridCard
        post={POST}
        selected={false}
        selectionActive={false}
        onToggleSelect={noop}
        onOpenMenu={noop}
      />
    );
    expect(screen.getByText("@someone")).toBeInTheDocument();
    expect(screen.getByText(/1,200 views/)).toBeInTheDocument();
  });

  it("selecting one tile does not re-render the others", () => {
    render(<SelectionHarness />);
    const twoTiles = renderSpy.mock.calls.length;
    expect(twoTiles).toBe(2);

    act(() => {
      screen.getByText("select first").click();
    });

    /* Both tiles render on the FIRST tick, and that is correct rather than a
       regression: the first tick turns the selection ON, which is exactly what
       makes every other tile's pick appear. selectionActive changed for both,
       so both had to be redrawn. */
    const afterFirst = renderSpy.mock.calls.length;
    expect(afterFirst).toBe(twoTiles + 2);

    act(() => {
      screen.getByText("select second").click();
    });
    /* The property that actually guards the grid: with a selection already
       running, adding a post to it redraws that post and nothing else. If this
       reads 2, the handlers have lost their identity and all 25 tiles are being
       redrawn per click. */
    expect(renderSpy.mock.calls.length).toBe(afterFirst + 1);
  });

  it("puts selection on the tile and nothing else", () => {
    /* The corner used to carry a tracking toggle and a link to the post page.
       Both are gone -- they are in the context menu now -- and what is left on
       a tile is the pick. Asserted, because "we removed the icons" is exactly
       the kind of change a later refactor puts back. */
    render(
      <PostGridCard
        post={POST}
        selected={false}
        selectionActive={false}
        onToggleSelect={noop}
        onOpenMenu={noop}
      />
    );
    expect(screen.getByLabelText("Select post by @someone")).toBeInTheDocument();
    expect(screen.queryByLabelText("Track this post")).toBeNull();
    expect(screen.queryByLabelText("View post analytics")).toBeNull();
  });

  it("right-clicking a tile asks the tab for a menu, at the cursor", () => {
    const onOpenMenu = jest.fn();
    render(
      <PostGridCard
        post={POST}
        selected={false}
        selectionActive={false}
        onToggleSelect={noop}
        onOpenMenu={onOpenMenu}
      />
    );
    fireEvent.contextMenu(screen.getByLabelText("Select post by @someone").closest(".cc-posttile")!, {
      clientX: 120,
      clientY: 340,
    });
    expect(onOpenMenu).toHaveBeenCalledWith("p1", 120, 340);
  });

  it("still says it is tracking, without offering a button", () => {
    // Tracking state has to stay visible on the grid: making it invisible is
    // the defect the on-card controls were added to fix in the first place.
    render(
      <PostGridCard
        post={{ ...POST, trackingEnabled: true, trackingExpiresAt: "2026-10-01T10:00:00.000Z" }}
        selected
        selectionActive
        onToggleSelect={noop}
        onOpenMenu={noop}
      />
    );
    const dot = document.querySelector('[title^="Tracking"]');
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("title")).toMatch(/^Tracking — stops in \d+ days?, on /);
    expect(screen.queryByLabelText("Stop tracking this post")).toBeNull();
  });
});
