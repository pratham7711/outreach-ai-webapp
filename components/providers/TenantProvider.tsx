"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { customBrandingValue } from "@/lib/brandingDefaults";

type TenantConfig = {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  plan?: string;
  features?: string[];
};

const TenantContext = createContext<TenantConfig>({});

export function useTenant() {
  return useContext(TenantContext);
}

/**
 * `initial` is rendered by the server layout, which already holds the org's
 * uiConfig. Anything the UI *hides* has to arrive that way: this provider's own
 * fetch lands in an effect after first paint, so a client-only value would
 * render the hidden thing and pull it away a moment later. Colours can tolerate
 * that (they repaint), a whole column cannot.
 */
export function TenantProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: TenantConfig;
}) {
  const [config, setConfig] = useState<TenantConfig>(initial ?? {});
  // The first render's `initial`, held so the effect below runs on mount only.
  const [seeded] = useState(initial);

  useEffect(() => {
    /* The dashboard layout renders `initial` from the same entitlements read
       /api/tenant/config answers from (tenantConfigFor), so with it there is
       nothing to fetch: that was a request, an auth check and an org read on
       every full page load, to learn what the server had just rendered. */
    if (seeded) {
      const fontFamily = customBrandingValue("fontFamily", seeded.fontFamily);
      if (fontFamily) document.documentElement.style.setProperty("--font-family", fontFamily);
      return;
    }
    fetch("/api/tenant/config")
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (!data) return;
        setConfig((prev) => ({ ...prev, ...data }));
        // The org's colours are deliberately NOT written here any more. An
        // inline custom property on <html> outranks every theme block, so a
        // brand colour repainted Light, Dark and CreatorCore alike; the three
        // themes now own the app's colours outright (October 2026).
        const fontFamily = customBrandingValue("fontFamily", data.fontFamily);
        if (fontFamily) document.documentElement.style.setProperty("--font-family", fontFamily);
      })
      .catch(() => {
        // Tenant config endpoint not available — use defaults
      });
  }, [seeded]);

  return (
    <TenantContext.Provider value={config}>
      {children}
    </TenantContext.Provider>
  );
}
