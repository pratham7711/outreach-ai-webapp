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
        if (primaryColor) root.style.setProperty("--color-primary", primaryColor);
        if (secondaryColor) root.style.setProperty("--color-secondary", secondaryColor);
        if (accentColor) root.style.setProperty("--color-accent", accentColor);
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
