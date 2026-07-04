"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Toaster } from "sonner";
import Link from "next/link";
import { LayoutDashboard, Compass, Send, DollarSign, Settings, LogOut, Star, Briefcase, Wallet, MessageSquare, Handshake, Menu, X } from "lucide-react";

const NAV_LINKS = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/discover", label: "Discover", icon: Compass },
  { href: "/portal/campaigns", label: "My Campaigns", icon: Briefcase },
  { href: "/portal/messages", label: "Messages", icon: MessageSquare },
  { href: "/portal/offers", label: "Offers", icon: Handshake },
  { href: "/portal/proposals", label: "Proposals", icon: Send },
  { href: "/portal/earnings", label: "Earnings", icon: Wallet },
  { href: "/portal/reviews", label: "Reviews", icon: Star },
  { href: "/portal/payout-requests", label: "Payouts", icon: DollarSign },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

function PortalNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.name) setUserName(data.name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setMobileOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
  };

  return (
    <nav
      style={{
        background: "var(--cc-card)",
        borderBottom: "1px solid var(--cc-border)",
        padding: "0 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        height: 56,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="lg:hidden rsp-touch"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            style={{
              width: 44,
              height: 44,
              marginLeft: -8,
              borderRadius: 10,
              background: "transparent",
              border: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "var(--cc-text)",
            }}
          >
            <Menu size={20} />
          </button>

          <Link
            href="/portal/dashboard"
            style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
          >
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
              Outreach AI
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cc-primary)",
                background: "rgba(91, 91, 214, 0.1)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              Portal
            </span>
          </Link>
        </div>

        <div className="hidden lg:flex" style={{ alignItems: "center", gap: 4 }}>
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href + "/");
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: isActive ? "var(--cc-primary)" : "var(--cc-text-muted)",
                  background: isActive ? "rgba(91, 91, 214, 0.08)" : "transparent",
                  transition: "background 0.15s, color 0.15s",
                  whiteSpace: "nowrap",
                }}
              >
                <Icon size={15} />
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {userName && (
          <span className="rsp-hide-mobile" style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
            {userName}
          </span>
        )}
        <button
          onClick={handleLogout}
          className="rsp-touch"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--cc-border)",
            background: "var(--cc-card)",
            color: "var(--cc-text-muted)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            transition: "color 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          <LogOut size={14} />
          <span className="rsp-hide-mobile">Logout</span>
        </button>
      </div>

      {mobileOpen && (
        <div
          className="lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            top: 56,
            background: "rgba(0, 0, 0, 0.4)",
            zIndex: 40,
          }}
        />
      )}

      <aside
        className={`lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
        role="navigation"
        aria-label="Portal navigation"
        style={{
          position: "fixed",
          top: 56,
          left: 0,
          bottom: 0,
          width: 260,
          maxWidth: "80vw",
          background: "var(--cc-sidebar)",
          borderRight: "1px solid var(--cc-border)",
          transition: "transform 0.2s ease",
          zIndex: 45,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 8px" }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)", paddingLeft: 4 }}>
            Menu
          </span>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="rsp-touch"
            style={{
              width: 44,
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--cc-text-muted)",
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div className="rsp-touch" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px 12px" }}>
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname?.startsWith(link.href + "/");
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 12px",
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: "none",
                  color: isActive ? "var(--cc-primary)" : "var(--cc-text-muted)",
                  background: isActive ? "rgba(91, 91, 214, 0.08)" : "transparent",
                }}
              >
                <Icon size={18} />
                {link.label}
              </Link>
            );
          })}
        </div>
      </aside>
    </nav>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/portal/login" || pathname === "/portal/register";

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <Toaster richColors position="bottom-right" />
      {!isLoginPage && <PortalNav />}
      {children}
    </div>
  );
}
