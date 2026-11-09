"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { RAIL_COOKIE, RAIL_COLLAPSED } from "@/lib/railCookie";

/**
 * The rail's state: whether the mobile drawer is open, and whether the desktop
 * rail is collapsed to its icons.
 *
 * Collapsing was removed once (bdd2f63) for three reasons, each answered here:
 * the campaign rail then had no icons, so collapsed rows were empty pills -- it
 * has an icon on every section now; the state lived in localStorage, so the
 * server painted the wide rail and the page jumped on hydration -- it is a
 * cookie now, read by the dashboard layout, so the first paint is already
 * right; and a stray click left the rail collapsed with no obvious way back --
 * the toggle is now a labelled control that never leaves the rail's edge, with
 * a tooltip on every icon while collapsed.
 */
type SidebarContextType = {
  mobileOpen: boolean;
  ready: boolean;
  collapsed: boolean;
  setMobileOpen: (open: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
};

const SidebarContext = createContext<SidebarContextType>({
  mobileOpen: false,
  ready: false,
  collapsed: false,
  setMobileOpen: () => {},
  setCollapsed: () => {},
  toggleCollapsed: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

const isTyping = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

export function SidebarProvider({
  children,
  initialCollapsed = false,
}: {
  children: ReactNode;
  /** From the rail cookie, read on the server so the first paint is the right width. */
  initialCollapsed?: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [collapsed, setCollapsedState] = useState(initialCollapsed);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    document.cookie = next
      ? `${RAIL_COOKIE}=${RAIL_COLLAPSED}; path=/; max-age=31536000; samesite=lax`
      : `${RAIL_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, []);

  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);

  /* Cmd+\ / Ctrl+\, the shortcut editors use for the same thing. Not while
     typing: a backslash in a search box is a backslash. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "\\" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      toggleCollapsed();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleCollapsed]);

  /* A fresh object literal here would hand every consumer a new context value
     on each render of this provider, which sits above the whole dashboard. */
  const value = useMemo(
    () => ({ mobileOpen, ready, collapsed, setMobileOpen, setCollapsed, toggleCollapsed }),
    [mobileOpen, ready, collapsed, setCollapsed, toggleCollapsed],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
