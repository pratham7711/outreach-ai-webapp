"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, Search, ChevronRight, Settings, LogOut } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Dropdown } from "@pratham7711/ui";
import { signOut } from "next-auth/react";
import ThemeToggle from "@/components/ThemeToggle";

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
  "/audit-log": "Audit Log",
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

function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

type TopBarUser = { name: string | null; email: string | null } | null;

export function TopBar({ user }: { user?: TopBarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchFocused, setSearchFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const segments = pathname.split("/").filter(Boolean);
  const currentPage = "/" + (segments[0] ?? "dashboard");
  const title = PAGE_TITLES[currentPage] ?? "Dashboard";
  const isDetailPage = segments.length > 1;

  // Breadcrumb leaf = the detail page's own <h1> (real entity name), not a literal "Detail".
  const [leaf, setLeaf] = useState<string | null>(null);
  useEffect(() => {
    if (!isDetailPage) { setLeaf(null); return; }
    const main = document.getElementById("main-content");
    if (!main) { setLeaf(null); return; }
    setLeaf(null);
    const obs = new MutationObserver(() => {
      const t = main.querySelector("h1")?.textContent?.trim();
      if (t) { setLeaf(t); obs.disconnect(); }
    });
    obs.observe(main, { childList: true, subtree: true });
    const t0 = main.querySelector("h1")?.textContent?.trim();
    if (t0) { setLeaf(t0); obs.disconnect(); }
    return () => obs.disconnect();
  }, [pathname, isDetailPage]);

  const prettySlug = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const leafLabel = leaf ?? prettySlug(segments[segments.length - 1] ?? "");

  const q = query.trim().toLowerCase();
  const matches = q
    ? Object.entries(PAGE_TITLES).filter(([, t]) => t.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const showResults = searchOpen && matches.length > 0;

  const go = (href: string) => {
    setQuery("");
    setSearchOpen(false);
    setActiveIdx(-1);
    router.push(href);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setSearchOpen(false);
      setActiveIdx(-1);
      return;
    }
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = matches[activeIdx >= 0 ? activeIdx : 0];
      if (pick) go(pick[0]);
    }
  };

  const initial = initials(user?.name, user?.email);
  const displayName = user?.name || user?.email || "Account";

  const accountItems = [
    { icon: <Settings size={15} />, label: "Settings", onClick: () => router.push("/settings") },
    { icon: <LogOut size={15} />, label: "Sign out", danger: true, onClick: () => signOut({ callbackUrl: "/login" }) },
  ];

  return (
    <header
      className="cc-topbar"
      style={{
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        borderBottom: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
        flexShrink: 0,
      }}
    >
      <style>{`
        .cc-topbar { padding-left: 32px; padding-right: 24px; }
        @media (max-width: 1023px) {
          .cc-topbar { padding-left: 60px; padding-right: 16px; }
        }
        @media (max-width: 520px) {
          .cc-topbar .cc-topbar-search { display: none; }
        }
      `}</style>
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
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
          Home
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
            <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {leafLabel}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600 }}>
            {title}
          </span>
        )}
      </nav>

      {/* Right side: Search + Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {/* Page search (jumps to a page) */}
        <div
          className="cc-topbar-search"
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
              top: 17,
              transform: "translateY(-50%)",
              color: searchFocused ? "var(--cc-primary)" : "var(--cc-text-subtle)",
              pointerEvents: "none",
              transition: "color 0.2s",
            }}
          />
          <input
            placeholder="Search pages..."
            aria-label="Search pages"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="cc-search-results"
            aria-autocomplete="list"
            className="cc-search"
            value={query}
            style={{
              padding: "7px 12px 7px 34px",
              fontSize: 13,
              borderRadius: 8,
              height: 34,
              width: "100%",
            }}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveIdx(-1); }}
            onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setSearchFocused(true); setSearchOpen(true); }}
            onBlur={() => { setSearchFocused(false); blurTimer.current = setTimeout(() => setSearchOpen(false), 120); }}
            onKeyDown={onSearchKeyDown}
          />
          {showResults && (
            <ul
              id="cc-search-results"
              role="listbox"
              aria-label="Page results"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 8,
                boxShadow: "var(--ui-shadow-lg)",
                padding: 4,
                margin: 0,
                listStyle: "none",
                zIndex: 60,
              }}
            >
              {matches.map(([href, t], i) => (
                <li key={href} role="option" aria-selected={i === activeIdx}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); go(href); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      display: "flex",
                      width: "100%",
                      textAlign: "left",
                      padding: "7px 10px",
                      fontSize: 13,
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      background: i === activeIdx ? "var(--cc-primary-light)" : "transparent",
                      color: "var(--cc-text)",
                    }}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <Dropdown
          align="right"
          tabIndex={0}
          role="button"
          aria-haspopup="menu"
          aria-label="Notifications"
          trigger={
            <span
              className="cc-btn-ghost"
              style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                color: "var(--cc-text-muted)",
              }}
            >
              <Bell size={17} aria-hidden="true" />
            </span>
          }
          items={[{ label: "No new notifications" }]}
        />

        {/* Account menu */}
        <Dropdown
          align="right"
          tabIndex={0}
          role="button"
          aria-haspopup="menu"
          aria-label={`Account menu for ${displayName}`}
          trigger={
            <span
              title={displayName}
              style={{
                width: 34,
                height: 34,
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
              {initial}
            </span>
          }
          items={accountItems}
        />
      </div>
    </header>
  );
}
