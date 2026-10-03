import { act, render } from "@testing-library/react";

let mockPathname = "/campaigns/c1";
let mockSearch = "section=overview";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import {
  announceNavigation,
  HARD_NAVIGATION_AFTER_MS,
  NavigationProgress,
} from "@/components/layout/NavigationProgress";

const bar = () => document.querySelector(".cc-nav-progress");

function at(path: string) {
  window.history.replaceState(null, "", path);
  const u = new URL(path, window.location.origin);
  mockPathname = u.pathname;
  mockSearch = u.search.slice(1);
}

describe("NavigationProgress", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    at("/campaigns/c1?section=overview");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows nothing for a navigation that commits quickly", () => {
    const hardNavigate = jest.fn();
    const { rerender } = render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=posts"));
    act(() => jest.advanceTimersByTime(50));
    at("/campaigns/c1?section=posts");
    rerender(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS * 2));
    expect(bar()).toBeNull();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("shows the bar while a navigation waits, and hides it on commit", () => {
    const hardNavigate = jest.fn();
    const { rerender } = render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=posts"));
    expect(bar()).toBeNull();
    act(() => jest.advanceTimersByTime(200));
    expect(bar()).not.toBeNull();
    at("/campaigns/c1?section=posts");
    rerender(<NavigationProgress hardNavigate={hardNavigate} />);
    expect(bar()).toBeNull();
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS * 2));
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("loads the page outright when the router has not committed in time", () => {
    const hardNavigate = jest.fn();
    render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=posts"));
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS - 1));
    expect(hardNavigate).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(hardNavigate).toHaveBeenCalledWith("/campaigns/c1?section=posts");
  });

  it("never reloads for a link to the page already open", () => {
    const hardNavigate = jest.fn();
    render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=overview"));
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS * 2));
    expect(bar()).toBeNull();
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("does not reload after the person went back to where they started", () => {
    const hardNavigate = jest.fn();
    const { rerender } = render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=posts"));
    at("/campaigns/c1?section=posts");
    rerender(<NavigationProgress hardNavigate={hardNavigate} />);
    at("/campaigns/c1?section=overview");
    rerender(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS * 2));
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it("follows only the latest of two quick clicks", () => {
    const hardNavigate = jest.fn();
    render(<NavigationProgress hardNavigate={hardNavigate} />);
    act(() => announceNavigation("/campaigns/c1?section=posts"));
    act(() => jest.advanceTimersByTime(3000));
    act(() => announceNavigation("/campaigns/c1?section=creators"));
    act(() => jest.advanceTimersByTime(HARD_NAVIGATION_AFTER_MS));
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    expect(hardNavigate).toHaveBeenCalledWith("/campaigns/c1?section=creators");
  });
});
