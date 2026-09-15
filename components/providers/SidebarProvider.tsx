"use client";

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react";

/**
 * The rail has one state.
 *
 * It used to have two, and the collapsed one was a liability rather than a
 * feature: it hid every label, left the campaign rail drawing empty pills once
 * that rail stopped carrying icons, and persisted itself to localStorage, so a
 * single stray click left the app broken on the next visit with no obvious way
 * back. Mobile still opens and closes the drawer -- that is `mobileOpen`, a
 * different thing from a desktop width toggle.
 */
type SidebarContextType = {
  mobileOpen: boolean;
  ready: boolean;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType>({
  mobileOpen: false,
  ready: false,
  setMobileOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  /* A fresh object literal here hands every consumer a new context value on
     each render of this provider, which is the one thing a context provider
     must not do: the provider sits above the whole dashboard, so that is a
     re-render of every component that calls useSidebar, for a value that has
     not changed. setMobileOpen is already stable (useState's setter). */
  const value = useMemo(() => ({ mobileOpen, ready, setMobileOpen }), [mobileOpen, ready]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}
