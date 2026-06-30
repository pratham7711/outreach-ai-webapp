"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Toaster } from "sonner";
import Link from "next/link";
import { LayoutDashboard, Compass, Send, DollarSign, Settings, LogOut, Star } from "lucide-react";

const NAV_LINKS = [
  { href: "/portal/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/discover", label: "Discover", icon: Compass },
  { href: "/portal/proposals", label: "Proposals", icon: Send },
  { href: "/portal/reviews", label: "Reviews", icon: Star },
  { href: "/portal/payout-requests", label: "Payouts", icon: DollarSign },
  { href: "/portal/settings", label: "Settings", icon: Settings },
];

function PortalNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState<string | null>(null);

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

  const handleLogout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
  };

  return (
    <nav
      style={{
        background: "var(--cc-card)",
        borderBottom: "1px solid var(--cc-border)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 56,
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      {/* Left: brand + nav links */}
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <Link
          href="/portal/dashboard"
          style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
        >
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>
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

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
                }}
              >
                <Icon size={15} />
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Right: user name + logout */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {userName && (
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
            {userName}
          </span>
        )}
        <button
          onClick={handleLogout}
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
          }}
        >
          <LogOut size={14} />
          Logout
        </button>
      </div>
    </nav>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/portal/login";

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      <Toaster richColors position="bottom-right" />
      {!isLoginPage && <PortalNav />}
      {children}
    </div>
  );
}
