"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Megaphone, Play, Calendar, Users, Radio, LineChart,
  Search, List, Wallet, Inbox, UserCheck, Link2, ClipboardList, Bell
} from "lucide-react";

const NAV_SECTIONS = [
  {
    label: "Campaigns & Reporting",
    items: [
      { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
      { href: "/activations", icon: Play, label: "Activations" },
      { href: "/calendar", icon: Calendar, label: "Calendar" },
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
      { href: "/recipients", icon: UserCheck, label: "Recipients" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/connections", icon: Link2, label: "Connections" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/plans", icon: ClipboardList, label: "Plans" },
    ],
  },
];

export default function NewSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-56 flex flex-col z-40"
      style={{ background: "var(--cc-sidebar)", borderRight: "1px solid var(--cc-border)" }}
    >
      {/* Logo + Org Badge */}
      <div className="h-14 flex items-center justify-between px-4" style={{ borderBottom: "1px solid var(--cc-border)" }}>
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#5B5BD6" strokeWidth="2.5"/>
            <circle cx="12" cy="12" r="5.5" stroke="#5B5BD6" strokeWidth="2"/>
            <circle cx="12" cy="12" r="2" fill="#5B5BD6"/>
          </svg>
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)", letterSpacing: "-0.3px" }}>
            creatorcore
          </span>
        </div>
        <div style={{
          background: "var(--cc-primary)", color: "#fff",
          fontSize: 10, fontWeight: 800, padding: "2px 7px",
          borderRadius: 6, letterSpacing: "0.5px"
        }}>
          LKM
        </div>
      </div>

      {/* Nav Sections */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-1">
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: "0.8px",
              textTransform: "uppercase", color: "var(--cc-text-subtle)",
              padding: "10px 10px 3px",
            }}>
              {section.label}
            </div>
            {section.items.map(({ href, icon: Icon, label, badge }: { href: string; icon: React.ElementType; label: string; badge?: string }) => {
              const active = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 mb-0.5"
                  style={{
                    background: active ? "var(--cc-primary)" : "transparent",
                    color: active ? "#ffffff" : "var(--cc-text-muted)",
                  }}
                >
                  <Icon size={15} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: active ? 600 : 500 }}>{label}</span>
                  {badge && !active && (
                    <span style={{
                      marginLeft: "auto", background: "var(--cc-primary)", color: "#fff",
                      fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                    }}>
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div style={{
              width: 30, height: 30, borderRadius: "50%",
              background: "var(--cc-primary)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 700, flexShrink: 0,
            }}>P</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>Pratham</span>
          </div>
          <button style={{ color: "var(--cc-text-muted)", background: "none", border: "none", cursor: "pointer" }}>
            <Bell size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
