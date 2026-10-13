"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search, ChevronRight, Settings, LogOut, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MenuButton } from "@/components/ds/MenuButton";
import { signOut } from "next-auth/react";
import { THEME_CHOICES, useThemeChoice } from "@/components/ThemeChoices";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { NAV_SECTIONS } from "@/components/NewSidebar";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campaigns",
  "/activations": "Activations",
  "/calendar": "Calendar",
  "/creators": "Creator Roster",
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
  "/inbox": "Inbox",
  "/deadlines": "Deadlines",
  "/financial-reports": "Financial Reports",
  "/songs": "Songs",
  "/platform": "All Organizations",
};

function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

type TopBarUser = { name: string | null; email: string | null } | null;

/* Search offers what the sidebar offers, and nothing else. PAGE_TITLES also
   names parked pages so their breadcrumb still reads right, which is why it
   cannot be the search list: it sent people to hidden payment pages. */
const SEARCHABLE = NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.href, i.label] as const));

export function TopBar({ user, navHrefs }: { user?: TopBarUser; navHrefs?: string[] | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const themeChoice = useThemeChoice();
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prettySlug = (s: string) => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const segments = pathname.split("/").filter(Boolean);
  const currentPage = "/" + (segments[0] ?? "dashboard");
  // Falling back to "Dashboard" made the breadcrumb lie on any route missing from
  // the map -- /deadlines read "Dashboard". The slug is at least the page you are on.
  const title = PAGE_TITLES[currentPage] ?? prettySlug(segments[0] ?? "Dashboard");
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

  const leafLabel = leaf ?? prettySlug(segments[segments.length - 1] ?? "");

  const q = query.trim().toLowerCase();
  const matches = q
    ? SEARCHABLE.filter(([href, t]) => (navHrefs == null || navHrefs.includes(href)) && t.toLowerCase().includes(q)).slice(0, 6)
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

  /* The menu takes a flat list of plain-text items -- no headings, no
     radio rows -- so each theme is its own item, "<X> theme", and the one in
     use trades its icon for a check and says "(current)". */
  const accountItems = [
    { icon: <Settings size={15} />, label: "Settings", onClick: () => router.push("/settings") },
    ...THEME_CHOICES.map(({ key, label, icon: Icon }) => {
      const on = themeChoice.current === key;
      return {
        icon: on ? <Check size={15} /> : <Icon size={15} />,
        label: on ? `${label} theme (current)` : `${label} theme`,
        onClick: () => themeChoice.choose(key),
      };
    }),
    { icon: <LogOut size={15} />, label: "Sign out", danger: true, onClick: () => signOut({ callbackUrl: "/login" }) },
  ];

  return (
    <header className="cc-topbar" data-region="topbar">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="cc-topbar-start" data-trail={isDetailPage ? "detail" : undefined}>
        <Link href="/dashboard" className="cc-crumb">
          Home
        </Link>
        <ChevronRight size={13} className="cc-crumb-sep" />
        {isDetailPage ? (
          <>
            <Link href={currentPage} className="cc-crumb">
              {title}
            </Link>
            <ChevronRight size={13} className="cc-crumb-sep" />
            <span title={leafLabel} className="cc-crumb-current" data-truncate="true">
              {leafLabel}
            </span>
          </>
        ) : (
          <span title={title} className="cc-crumb-current" data-truncate="true">{title}</span>
        )}
      </nav>

      {/* Right side: Search + Actions */}
      <div className="cc-topbar-end">
        {/* Page search (jumps to a page) */}
        <div className="cc-topbar-search">
          <Search size={15} aria-hidden="true" className="cc-topbar-search-icon" />
          <input
            placeholder="Search pages..."
            aria-label="Search pages"
            role="combobox"
            aria-expanded={showResults}
            aria-controls="cc-search-results"
            aria-autocomplete="list"
            className="cc-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchOpen(true); setActiveIdx(-1); }}
            onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setSearchOpen(true); }}
            onBlur={() => { blurTimer.current = setTimeout(() => setSearchOpen(false), 120); }}
            onKeyDown={onSearchKeyDown}
          />
          {showResults && (
            <ul
              id="cc-search-results"
              role="listbox"
              aria-label="Page results"
              className="cc-search-results"
            >
              {matches.map(([href, t], i) => (
                <li key={href} role="option" aria-selected={i === activeIdx}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); go(href); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className="cc-search-result"
                    data-active={i === activeIdx}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Feedback lives in the bar, not over the page: as a floating pill it
            sat on whatever control a page put in its bottom-right corner. */}
        <FeedbackButton surface="dashboard" />

        {/* Notifications */}
        <NotificationBell />

        {/* Account menu */}
        <MenuButton
          align="right"
          label={`Account menu for ${displayName}`}
          trigger={
            <span
              title={displayName}
              className="cc-topbar-avatar"
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
