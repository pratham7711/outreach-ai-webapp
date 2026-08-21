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

export function TenantProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<TenantConfig>({});

  useEffect(() => {
    fetch("/api/tenant/config")
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (!data) return;
        setConfig(data);
        const root = document.documentElement;
        const primaryColor = customBrandingValue("primaryColor", data.primaryColor);
        const secondaryColor = customBrandingValue("secondaryColor", data.secondaryColor);
        const accentColor = customBrandingValue("accentColor", data.accentColor);
        const fontFamily = customBrandingValue("fontFamily", data.fontFamily);
        // Write the root tokens, not the aliases. Both --cc-* and --color-* are
        // defined as var(--primary) etc. in globals.css, so overriding an alias
        // leaves it reading the unchanged token it was derived from and the
        // tenant's colour paints nothing.
        if (primaryColor) root.style.setProperty("--primary", primaryColor);
        if (secondaryColor) root.style.setProperty("--secondary", secondaryColor);
        if (accentColor) root.style.setProperty("--accent", accentColor);
        if (fontFamily) root.style.setProperty("--font-family", fontFamily);
      })
      .catch(() => {
        // Tenant config endpoint not available — use defaults
      });
  }, []);

  return (
    <TenantContext.Provider value={config}>
      {children}
    </TenantContext.Provider>
  );
}
