"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  LayoutDashboard, Megaphone, Play, Calendar, CalendarClock, Users, Users2, Radio, LineChart,
  Search, List, Wallet, Inbox, UserCheck, Link2, CreditCard, Shield, FileText,
  ChevronDown, Settings, LogOut, Menu, X, ChevronsLeft, Key, PieChart, BarChart2, Activity
} from "lucide-react";
import { useSidebar } from "@/components/providers/SidebarProvider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NAV_SECTIONS = [
  {
    label: "Campaigns & Reporting",
    items: [
      { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
      { href: "/inbox", icon: Inbox, label: "Inbox" },
      { href: "/activations", icon: Play, label: "Activations" },
      { href: "/calendar", icon: Calendar, label: "Calendar" },
      { href: "/deadlines", icon: CalendarClock, label: "Deadlines" },
      { href: "/clients", icon: Users, label: "Clients" },
      { href: "/fan-pages", icon: Radio, label: "Fan Pages", badge: "Soon" },
      { href: "/trackers", icon: LineChart, label: "Trackers" },
    ],
  },
  {
    label: "Creators & Pitching",
    items: [
      { href: "/discovery", icon: Search, label: "Discovery" },
      { href: "/creators", icon: Users, label: "Creators" },
      { href: "/lists", icon: List, label: "Lists" },
    ],
  },
  {
    label: "Financial",
    items: [
      { href: "/payouts", icon: Wallet, label: "Payouts" },
      { href: "/requests", icon: Inbox, label: "Requests" },
      { href: "/financial-reports", icon: PieChart, label: "Financials" },
      { href: "/analytics", icon: BarChart2, label: "Analytics" },
      { href: "/recipients", icon: UserCheck, label: "Recipients" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/connections", icon: Link2, label: "Connections" },
      { href: "/audit-log", icon: FileText, label: "Audit Log" },
      { href: "/settings/team", icon: Users2, label: "Team" },
      { href: "/settings/api-keys", icon: Key, label: "API Keys" },
      { href: "/settings/billing", icon: CreditCard, label: "Billing" },
      { href: "/settings/ingestion", icon: Activity, label: "Ingestion" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", icon: Shield, label: "Feature Access" },
      { href: "/plans", icon: CreditCard, label: "Plans" },
    ],
  },
];

type SidebarProps = {
  allowedNavHrefs?: string[] | null;
  brandName?: string | null;
  user?: { name: string | null; email: string | null } | null;
};

function sidebarInitials(name?: string | null, email?: string | null): string {
  const src = (name || email || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function UserMenuTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default function NewSidebar({ allowedNavHrefs, brandName, user }: SidebarProps = {}) {
  const userName = user?.name || user?.email || "Account";
  const userInitial = sidebarInitials(user?.name, user?.email);
  const pathname = usePathname();
  const { collapsed, mobileOpen, ready, toggle, setMobileOpen } = useSidebar();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const allowedHrefSet = useMemo(
    () => new Set(allowedNavHrefs ?? []),
    [allowedNavHrefs]
  );

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  // Close on escape key
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && mobileOpen) {
      setMobileOpen(false);
    }
  }, [mobileOpen, setMobileOpen]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Close user menu when collapsing
  useEffect(() => {
    if (collapsed) setShowUserMenu(false);
  }, [collapsed]);

  const isRail = collapsed && !mobileOpen;

  const logoMark = (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "var(--cc-primary)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8" stroke="white" strokeWidth="2.5" />
        <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1.5" />
        <circle cx="12" cy="12" r="1.5" fill="white" />
      </svg>
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className={`fixed top-1.5 left-2 z-50 size-11 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card shadow-sm lg:hidden ${
          mobileOpen ? "hidden" : "flex"
        }`}
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileOpen}
      >
        <Menu size={20} aria-hidden="true" className="text-foreground" />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.4)",
            zIndex: 40,
            transition: "opacity 0.2s",
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`cc-sidebar-rail fixed top-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        data-collapsed={mobileOpen ? false : collapsed}
        data-ready={ready}
        style={{
          background: "var(--cc-sidebar)",
          borderRight: "1px solid var(--cc-border)",
        }}
        role="navigation"
        aria-label="Main sidebar"
      >
        {/* Header: Logo + Org + Collapse Toggle */}
        <div
          className={`h-14 flex items-center shrink-0 ${isRail ? "justify-center" : "justify-between"}`}
          style={{
            borderBottom: "1px solid var(--cc-border)",
            padding: isRail ? "0 8px" : "0 16px",
          }}
        >
          {isRail ? (
            <Tooltip>
              <TooltipTrigger
                onClick={toggle}
                aria-label="Expand sidebar"
                className="btn-press flex cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0"
              >
                {logoMark}
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          ) : (
            <>
              <div className="flex min-w-0 items-center gap-2.5">
                {logoMark}
                <span
                  className="truncate"
                  title={brandName ?? "outreach ai"}
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    color: "var(--cc-text)",
                    letterSpacing: "-0.4px",
                  }}
                >
                  {brandName ?? "outreach ai"}
                </span>
              </div>

              <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
                <div
                  style={{
                    background: "var(--cc-primary)",
                    color: "var(--primary-foreground)",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 10px",
                    borderRadius: 6,
                    letterSpacing: "0.5px",
                  }}
                >
                  LKM
                </div>

                {/* Mobile close */}
                <button
                  className="flex cursor-pointer items-center rounded-md border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground lg:hidden"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <X size={18} aria-hidden="true" />
                </button>

                {/* Desktop collapse toggle */}
                <button
                  className="btn-press hidden cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-primary lg:flex"
                  onClick={toggle}
                  aria-label="Collapse sidebar"
                >
                  <ChevronsLeft size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav Sections */}
        <nav className="cc-sidebar-nav flex-1 overflow-y-auto px-2 py-2" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => {
            const filteredItems = allowedNavHrefs == null
              ? section.items
              : section.items.filter((item) => allowedHrefSet.has(item.href));
            if (filteredItems.length === 0) return null;
            return (
            <div key={section.label} className="mb-1">
              {/* Section label — hidden when collapsed */}
              {!isRail && (
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.8px",
                    textTransform: "uppercase",
                    color: "var(--cc-text-subtle)",
                    padding: "12px 12px 4px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                  }}
                >
                  {section.label}
                </div>
              )}
              {/* Thin separator when collapsed */}
              {isRail && (
                <div style={{ height: 1, background: "var(--cc-border)", margin: "6px 8px" }} />
              )}

              {filteredItems.map(
                ({
                  href,
                  icon: Icon,
                  label,
                  badge,
                }: {
                  href: string;
                  icon: React.ElementType;
                  label: string;
                  badge?: string;
                }) => {
                  const active = pathname === href || pathname.startsWith(href + "/");
                  const navLink = (
                    <Link
                      href={href}
                      className={`cc-nav-item sidebar-link ${active ? "active btn-press" : ""}`}
                      aria-current={active ? "page" : undefined}
                      style={{
                        justifyContent: isRail ? "center" : undefined,
                        padding: isRail ? "10px" : undefined,
                      }}
                    >
                      <Icon
                        size={isRail ? 19 : 17}
                        style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}
                        aria-hidden="true"
                      />
                      {!isRail && (
                        <span style={{ fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden" }}>
                          {label}
                        </span>
                      )}
                      {!isRail && badge && !active && (
                        <span
                          style={{
                            marginLeft: "auto",
                            background: "var(--cc-primary)",
                            color: "var(--primary-foreground)",
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 999,
                            letterSpacing: "0.3px",
                          }}
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                  );

                  // The rail clips its own overflow, so a CSS tooltip can never
                  // escape it — the portalled Tooltip is what makes icon-only
                  // navigation readable.
                  if (!isRail) return <div key={href}>{navLink}</div>;

                  return (
                    <Tooltip key={href}>
                      <TooltipTrigger render={navLink} />
                      <TooltipContent side="right" sideOffset={8}>
                        {label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }
              )}
            </div>
            );
          })}
        </nav>

        {/* Footer - User Profile */}
        <div
          className="px-2 py-2"
          style={{ borderTop: "1px solid var(--cc-border)", position: "relative" }}
        >
          {/* User menu dropdown */}
          {showUserMenu && !isRail && (
            <div
              className="cc-scale-in"
              style={{
                position: "absolute",
                bottom: "100%",
                left: 8,
                right: 8,
                marginBottom: 4,
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                boxShadow: "var(--ui-shadow-lg)",
                overflow: "hidden",
                zIndex: 50,
              }}
            >
              <Link
                href="/settings"
                className="cc-nav-item"
                style={{ margin: 4, borderRadius: 8 }}
                onClick={() => setShowUserMenu(false)}
              >
                <Settings size={15} aria-hidden="true" />
                <span style={{ fontSize: 13 }}>Settings</span>
              </Link>
              <div style={{ height: 1, background: "var(--cc-border)", margin: "0 12px" }} />
              <button
                className="cc-nav-item"
                style={{
                  margin: 4,
                  borderRadius: 8,
                  width: "calc(100% - 8px)",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "var(--cc-danger)",
                }}
                aria-label="Sign out of your account"
                onClick={() => { setShowUserMenu(false); signOut({ callbackUrl: "/login" }); }}
              >
                <LogOut size={15} aria-hidden="true" />
                <span style={{ fontSize: 13 }}>Sign out</span>
              </button>
            </div>
          )}

          <UserMenuTooltip label={userName} enabled={isRail}>
          <button
            onClick={() => {
              if (isRail) {
                toggle();
                return;
              }
              setShowUserMenu(!showUserMenu);
            }}
            className="cc-table-row"
            aria-expanded={showUserMenu}
            aria-label={isRail ? `${userName} — expand sidebar` : "User menu"}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: isRail ? "center" : "space-between",
              padding: isRail ? "8px" : "8px 10px",
              borderRadius: 10,
              border: "none",
              background: showUserMenu ? "var(--cc-primary-light)" : "transparent",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "var(--cc-primary)",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                {userInitial}
              </div>
              {!isRail && (
                <span
                  title={userName}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--cc-text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 140,
                  }}
                >
                  {userName}
                </span>
              )}
            </div>
            {!isRail && (
              <div className="flex items-center gap-2">
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  style={{
                    color: "var(--cc-text-muted)",
                    transform: showUserMenu ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                />
              </div>
            )}
          </button>
          </UserMenuTooltip>
        </div>
      </aside>
    </>
  );
}
