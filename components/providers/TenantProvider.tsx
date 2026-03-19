"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
        if (data.primaryColor) root.style.setProperty("--color-primary", data.primaryColor);
        if (data.secondaryColor) root.style.setProperty("--color-secondary", data.secondaryColor);
        if (data.accentColor) root.style.setProperty("--color-accent", data.accentColor);
        if (data.fontFamily) root.style.setProperty("--font-family", data.fontFamily);
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
