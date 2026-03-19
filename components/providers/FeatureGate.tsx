"use client";

import { useTenant } from "./TenantProvider";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

export function FeatureGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { features, plan } = useTenant();

  const hasAccess = !features || features.includes(feature);

  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative rounded-xl border border-[#2A2A3A] bg-[#111118] p-8 text-center">
      <div className="absolute inset-0 rounded-xl bg-[#0A0A0F]/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10">
        <div className="w-12 h-12 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
          <Lock className="h-5 w-5 text-[var(--color-primary)]" />
        </div>
        <p className="text-sm font-semibold text-[#F0F0FF]">Upgrade to unlock</p>
        <p className="text-xs text-[#8888AA]">
          This feature requires the {plan === "FREE" ? "Pro" : "Enterprise"} plan
        </p>
        <button className="mt-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-hover)] transition-colors">
          Upgrade Plan
        </button>
      </div>
      <div className="opacity-20 pointer-events-none">{children}</div>
    </div>
  );
}
