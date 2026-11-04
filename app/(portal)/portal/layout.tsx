"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ThemedToaster } from "@/components/layout/ThemedToaster";
import Link from "next/link";
import { Home, Briefcase, Link2, BarChart3, UserRound, LogOut, Wallet } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { ConfirmProvider } from "@/components/ds";
import { LegalLinks } from "@/components/LegalLinks";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

/**
 * The creator app's frame: five places, and nothing that talks to the creator.
 *
 * Messages, offers, proposals, earnings, payouts and reviews are gone from the
 * nav; their URLs redirect to Home (next.config.ts, PARKED_PAGE_REDIRECTS) and
 * their code stays on disk. Settings became My accounts and Account.
 *
 * Phones get a bottom tab bar, the pattern a creator's other apps use, and
 * desktops a row of links in the top bar. Both read the same list.
 */
/* Earnings -- what a creator has earned and the payout requests made against
   it -- is listed only while payouts are switched on (lib/payouts/switch.ts).
   Off, its URL redirects Home with the rest of the payout screens. */
const PAYOUT_NAV_LINKS = [
  { href: "/portal/earnings", label: "Earnings", icon: Wallet },
];

const NAV_LINKS = [
  { href: "/portal/dashboard", label: "Home", icon: Home },
  { href: "/portal/campaigns", label: "Campaigns", icon: Briefcase },
  { href: "/portal/accounts", label: "My accounts", icon: Link2 },
  { href: "/portal/stats", label: "My stats", icon: BarChart3 },
  ...(PAYOUTS_ENABLED ? PAYOUT_NAV_LINKS : []),
  { href: "/portal/account", label: "Account", icon: UserRound },
];

const isActive = (pathname: string | null, href: string) =>
  pathname === href || !!pathname?.startsWith(href + "/");

function PortalNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [userName, setUserName] = useState<string | null>(null);
  /* Feedback is offered to a signed-in creator only. This layout renders before
     anything has checked the session, so a signed-out visitor bounced to the
     login page would otherwise see it for a moment. */
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    fetch("/api/portal/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSignedIn(true);
        if (data?.name) setUserName(data.name);
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
  };

  return (
    <>
      <nav
        aria-label="Creator app"
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
        <div style={{ display: "flex", alignItems: "center", gap: 28, minWidth: 0 }}>
          <Link href="/portal/dashboard" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
            <span className="lp-brand-mark" aria-hidden style={{ width: 28, height: 28, fontSize: 11 }}>
              {BRAND.short}
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
              {BRAND.name}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cc-text)",
                background: "var(--cc-primary-light)",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              Creator
            </span>
          </Link>

          <div className="hidden lg:flex" style={{ alignItems: "center", gap: 4 }}>
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    textDecoration: "none",
                    color: active ? "var(--cc-primary)" : "var(--cc-text-muted)",
                    background: active ? "var(--cc-primary-light)" : "transparent",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* In the header, not floating: the phone tab bar and the page's own
              last controls both live along the bottom edge. */}
          {signedIn && <FeedbackButton surface="portal" />}
          {userName && (
            <span className="rsp-hide-mobile" style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", whiteSpace: "nowrap" }}>
              {userName}
            </span>
          )}
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Log out"
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
              whiteSpace: "nowrap",
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            <span className="rsp-hide-mobile">Log out</span>
          </button>
        </div>
      </nav>

      <nav
        aria-label="Creator app tabs"
        /* display in the class, not the style: an inline display:grid outranks
           lg:hidden, so the phone bar sat over the last 57px of every desktop
           page while its spacer (which has no inline display) was hidden. */
        className="grid lg:hidden"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          gridTemplateColumns: `repeat(${NAV_LINKS.length}, 1fr)`,
          background: "var(--cc-card)",
          borderTop: "1px solid var(--cc-border)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href);
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                minHeight: 56,
                padding: "6px 2px",
                fontSize: 11,
                fontWeight: active ? 700 : 600,
                textDecoration: "none",
                color: active ? "var(--cc-primary)" : "var(--cc-text-muted)",
                textAlign: "center",
                lineHeight: 1.2,
              }}
            >
              <Icon size={20} aria-hidden="true" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthPage = pathname === "/portal/login" || pathname === "/portal/register";

  return (
    <ConfirmProvider>
      <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
        <ThemedToaster richColors position="top-center" />
        {!isAuthPage && <PortalNav />}
        {children}
        {/* The sign-in pages carry these under their own card. */}
        {!isAuthPage && (
          <footer style={{ padding: "24px 16px" }}>
            <LegalLinks />
          </footer>
        )}
        {/* Room for the phone tab bar, so it never covers the last row. */}
        {!isAuthPage && <div className="lg:hidden" aria-hidden="true" style={{ height: 80 }} />}
      </div>
    </ConfirmProvider>
  );
}
