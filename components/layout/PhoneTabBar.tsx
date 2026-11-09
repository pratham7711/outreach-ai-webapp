"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Megaphone, Users, LineChart, Menu } from "lucide-react";
import { useSidebar } from "@/components/providers/SidebarProvider";

/**
 * The phone's main navigation: four destinations and More, in a bar at the
 * bottom of the screen where a thumb reaches, as the creator portal does.
 * More opens the same drawer the rail turns into below 1024px, which still
 * holds every page, the campaign's own sections and the account menu.
 * Hidden from 768px up by the stylesheet.
 */
const TABS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/creators", label: "Creators", icon: Users },
  { href: "/trackers", label: "Trackers", icon: LineChart },
];

export function PhoneTabBar({ navHrefs }: { navHrefs?: string[] | null }) {
  const pathname = usePathname() ?? "";
  const { mobileOpen, setMobileOpen } = useSidebar();
  const tabs = TABS.filter((t) => navHrefs == null || navHrefs.includes(t.href));
  const activeHref = tabs.find((t) => pathname === t.href || pathname.startsWith(t.href + "/"))?.href;

  return (
    <nav className="cc-phone-tabs" aria-label="Main">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = href === activeHref && !mobileOpen;
        return (
          <Link key={href} href={href} className="cc-phone-tab" aria-current={active ? "page" : undefined}>
            <Icon aria-hidden="true" className="cc-phone-tab-icon" />
            <span>{label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="cc-phone-tab"
        aria-expanded={mobileOpen}
        aria-controls="cc-rail"
        data-active={mobileOpen || !activeHref || undefined}
        onClick={() => setMobileOpen(true)}
      >
        <Menu aria-hidden="true" className="cc-phone-tab-icon" />
        <span>More</span>
      </button>
    </nav>
  );
}
