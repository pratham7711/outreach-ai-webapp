"use client";

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

type SidebarContextType = {
  collapsed: boolean;
  mobileOpen: boolean;
  ready: boolean;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  mobileOpen: false,
  ready: false,
  toggle: () => {},
  setMobileOpen: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

const STORAGE_KEY = "cc-sidebar-collapsed";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // Persist collapse preference
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(STORAGE_KEY, String(!prev));
      return !prev;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, mobileOpen, ready, toggle, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}
