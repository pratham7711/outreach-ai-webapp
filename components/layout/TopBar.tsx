"use client";

import { usePathname } from "next/navigation";
import { Bell, Search, ChevronRight } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

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
  "/admin": "Feature Access",
  "/fan-pages": "Fan Pages",
  "/requests": "Requests",
  "/recipients": "Recipients",
};

export function TopBar() {
  const pathname = usePathname();
  const [searchFocused, setSearchFocused] = useState(false);
  const segments = pathname.split("/").filter(Boolean);
  const currentPage = "/" + (segments[0] ?? "dashboard");
  const title = PAGE_TITLES[currentPage] ?? "Dashboard";
  const isDetailPage = segments.length > 1;

  return (
    <header
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: 32,
        paddingRight: 24,
        borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
        flexShrink: 0,
      }}
    >
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Link
          href="/dashboard"
          style={{
            fontSize: 13,
            color: "var(--cc-text-muted)",
            textDecoration: "none",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cc-primary)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-muted)"; }}
        >
          Pages
        </Link>
        <ChevronRight size={13} style={{ color: "var(--cc-text-subtle)" }} />
        {isDetailPage ? (
          <>
            <Link
              href={currentPage}
              style={{
                fontSize: 13,
                color: "var(--cc-text-muted)",
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cc-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-muted)"; }}
            >
              {title}
            </Link>
            <ChevronRight size={13} style={{ color: "var(--cc-text-subtle)" }} />
            <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600 }}>
              Detail
            </span>
          </>
        ) : (
          <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600 }}>
            {title}
          </span>
        )}
      </nav>

      {/* Right side: Search + Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Inline search */}
        <div
          style={{
            position: "relative",
            width: searchFocused ? 260 : 180,
            transition: "width 0.25s ease",
          }}
        >
          <Search
            size={15}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: searchFocused ? "var(--cc-primary)" : "var(--cc-text-subtle)",
              pointerEvents: "none",
              transition: "color 0.2s",
            }}
          />
          <input
            placeholder="Search..."
            aria-label="Search pages"
            className="cc-search"
            style={{
              padding: "7px 12px 7px 34px",
              fontSize: 13,
              borderRadius: 8,
              height: 34,
            }}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
        </div>

        {/* Notification bell */}
        <button
          className="cc-btn-ghost cc-notification-dot"
          aria-label="Notifications"
          style={{
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            background: "transparent",
            color: "var(--cc-text-muted)",
            transition: "all 0.15s",
          }}
        >
          <Bell size={17} aria-hidden="true" />
        </button>

        {/* User avatar */}
        <button
          aria-label="User profile"
          style={{
            border: "none",
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #5B5BD6, #7B7DE8)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            transition: "box-shadow 0.2s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 0 0 3px rgba(91,91,214,0.2)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "none"; }}
        >
          P
        </button>
      </div>
    </header>
  );
}
