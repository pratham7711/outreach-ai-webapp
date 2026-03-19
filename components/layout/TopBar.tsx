"use client";

import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campaigns",
  "/activations": "Activations",
  "/calendar": "Calendar",
  "/creators": "Creators",
  "/lists": "Lists",
  "/discovery": "Discovery",
  "/payouts": "Payouts",
  "/clients": "Clients",
  "/trackers": "Trackers",
  "/connections": "Connections",
  "/reports": "Reports",
  "/media-kits": "Media Kits",
  "/settings": "Settings",
  "/analytics": "Analytics",
  "/plans": "Plans",
};

export function TopBar() {
  const pathname = usePathname();
  const segment = "/" + (pathname.split("/")[1] ?? "dashboard");
  const title = PAGE_TITLES[segment] ?? "Dashboard";

  return (
    <header
      style={{
        height: "56px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: "24px",
        paddingRight: "24px",
        borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <span style={{ color: "var(--cc-text-muted)" }}>Pages</span>
        <span style={{ color: "var(--cc-text-muted)" }}>/</span>
        <span style={{ color: "var(--cc-text)", fontWeight: 600 }}>{title}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          style={{
            padding: "8px",
            borderRadius: "8px",
            background: "transparent",
            border: "none",
            color: "var(--cc-text-muted)",
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cc-text)";
            (e.currentTarget as HTMLElement).style.background = "rgba(91, 91, 214, 0.05)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = "var(--cc-text-muted)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <Bell size={16} />
        </button>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--cc-primary)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          A
        </div>
      </div>
    </header>
  );
}
