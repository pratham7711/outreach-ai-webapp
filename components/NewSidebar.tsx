"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Megaphone, Play, Calendar, CalendarClock, Users, Users2, Radio, LineChart,
  Search, List, Wallet, Inbox, UserCheck, Link2, CreditCard, Shield, Bell, FileText,
  ChevronDown, Settings, LogOut, Menu, X, ChevronsLeft, ChevronsRight, Key, PieChart
} from "lucide-react";
import { useSidebar } from "@/components/providers/SidebarProvider";

const NAV_SECTIONS = [
  {
    label: "Campaigns & Reporting",
    items: [
      { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
      { href: "/activations", icon: Play, label: "Activations" },
      { href: "/calendar", icon: Calendar, label: "Calendar" },
      { href: "/deadlines", icon: CalendarClock, label: "Deadlines" },
      { href: "/clients", icon: Users, label: "Clients" },
      { href: "/fan-pages", icon: Radio, label: "Fan Pages", badge: "NEW" },
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
};

export default function NewSidebar({ allowedNavHrefs, brandName }: SidebarProps = {}) {
  const pathname = usePathname();
  const { collapsed, mobileOpen, toggle, setMobileOpen } = useSidebar();
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

  const sidebarWidth = collapsed ? 68 : 256;

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation menu"
        style={{
          position: "fixed",
          top: 14,
          left: 14,
          zIndex: 50,
          width: 40,
          height: 40,
          borderRadius: 10,
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <Menu size={20} style={{ color: "var(--cc-text)" }} />
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
        className={`fixed left-0 top-0 bottom-0 flex flex-col z-40 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
        style={{
          width: mobileOpen ? 256 : sidebarWidth,
          background: "var(--cc-sidebar)",
          borderRight: "1px solid var(--cc-border)",
          transition: "width 0.2s ease, transform 0.2s ease",
          overflow: "hidden",
        }}
        role="navigation"
        aria-label="Main sidebar"
      >
        {/* Header: Logo + Org + Collapse Toggle */}
        <div
          className="h-14 flex items-center justify-between shrink-0"
          style={{
            borderBottom: "1px solid var(--cc-border)",
            padding: collapsed ? "0 12px" : "0 16px",
          }}
        >
          <div className="flex items-center gap-2.5" style={{ overflow: "hidden" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "linear-gradient(135deg, #5B5BD6 0%, #7B7DE8 100%)",
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
            {!collapsed && (
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 15,
                  color: "var(--cc-text)",
                  letterSpacing: "-0.4px",
                  whiteSpace: "nowrap",
                }}
              >
                {brandName ?? "outreach ai"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
            {!collapsed && (
              <div
                style={{
                  background: "var(--cc-primary)",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 6,
                  letterSpacing: "0.5px",
                }}
              >
                LKM
              </div>
            )}

            {/* Mobile close */}
            <button
              className="lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation menu"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "var(--cc-text-muted)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={18} />
            </button>

            {/* Desktop collapse toggle */}
            <button
              className="hidden lg:flex btn-press"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                color: "var(--cc-text-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 6,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--cc-primary-light)";
                e.currentTarget.style.color = "var(--cc-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = "var(--cc-text-muted)";
              }}
            >
              {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
            </button>
          </div>
        </div>

        {/* Nav Sections */}
        <nav className="flex-1 overflow-y-auto py-2 px-2" aria-label="Main navigation">
          {NAV_SECTIONS.map((section) => {
            const filteredItems = allowedNavHrefs == null
              ? section.items
              : section.items.filter((item) => allowedHrefSet.has(item.href));
            if (filteredItems.length === 0) return null;
            return (
            <div key={section.label} className="mb-1">
              {/* Section label — hidden when collapsed */}
              {!collapsed && (
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
              {collapsed && (
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
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`cc-nav-item sidebar-link ${active ? "active btn-press" : ""} cc-tooltip`}
                      aria-current={active ? "page" : undefined}
                      data-tooltip={collapsed ? label : undefined}
                      style={{
                        justifyContent: collapsed ? "center" : undefined,
                        padding: collapsed ? "10px" : undefined,
                      }}
                    >
                      <Icon
                        size={collapsed ? 19 : 17}
                        style={{ flexShrink: 0, opacity: active ? 1 : 0.7 }}
                        aria-hidden="true"
                      />
                      {!collapsed && (
                        <span style={{ fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden" }}>
                          {label}
                        </span>
                      )}
                      {!collapsed && badge && !active && (
                        <span
                          style={{
                            marginLeft: "auto",
                            background: "linear-gradient(135deg, #5B5BD6, #7C3AED)",
                            color: "#fff",
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
          {showUserMenu && !collapsed && (
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
              >
                <LogOut size={15} aria-hidden="true" />
                <span style={{ fontSize: 13 }}>Sign out</span>
              </button>
            </div>
          )}

          <button
            onClick={() => {
              if (collapsed) {
                // If collapsed, expand first then show menu
                toggle();
                setTimeout(() => setShowUserMenu(true), 200);
              } else {
                setShowUserMenu(!showUserMenu);
              }
            }}
            className="cc-table-row"
            aria-expanded={showUserMenu}
            aria-label="User menu"
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "space-between",
              padding: collapsed ? "8px" : "8px 10px",
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
                  background: "linear-gradient(135deg, #5B5BD6, #7B7DE8)",
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
                P
              </div>
              {!collapsed && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "var(--cc-text)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Pratham
                </span>
              )}
            </div>
            {!collapsed && (
              <div className="flex items-center gap-2">
                <div className="cc-notification-dot">
                  <Bell size={16} style={{ color: "var(--cc-text-muted)" }} aria-hidden="true" />
                </div>
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
        </div>
      </aside>
    </>
  );
}
