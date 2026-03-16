"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Megaphone, Users, Wallet, Search, Calendar, List, Bell, Settings, BarChart3, Link2, UserSquare2 } from "lucide-react";
import ThemeToggle from "./ThemeToggle";

const NAV = [
  { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
  { href: "/activations", icon: BarChart3, label: "Activations" },
  { href: "/creators", icon: Users, label: "Creators" },
  { href: "/discovery", icon: Search, label: "Discovery" },
  { href: "/payouts", icon: Wallet, label: "Payouts" },
  { href: "/calendar", icon: Calendar, label: "Calendar" },
  { href: "/lists", icon: List, label: "Lists" },
  { href: "/trackers", icon: BarChart3, label: "Trackers" },
  { href: "/requests", icon: Bell, label: "Requests" },
  { href: "/connections", icon: Link2, label: "Connections" },
  { href: "/clients", icon: UserSquare2, label: "Clients" },
];

export default function NewSidebar() {
  const pathname = usePathname();
  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-60 flex flex-col z-40"
      style={{
        background: "var(--cc-sidebar)",
        borderRight: "1px solid var(--cc-border)",
      }}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-5" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-1.5">
          <span style={{ color: "#2563EB", fontSize: 16 }}>✦</span>
          <span style={{ fontWeight: 900, fontSize: 17, color: "var(--cc-text)" }}>creatorcore</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 flex flex-col gap-1">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group"
              style={{
                background: active ? "rgba(37,99,235,0.12)" : "transparent",
                color: active ? "#3b82f6" : "var(--cc-text-muted)",
              }}
            >
              <Icon size={17} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: active ? 700 : 500 }}>{label}</span>
              {active && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#3b82f6" }} />}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4" style={{ borderTop: "1px solid var(--cc-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">P</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>Pratham</div>
              <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>Admin</div>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
