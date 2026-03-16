"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  LayoutGrid,
  Zap,
  Calendar,
  Search,
  Users,
  List,
  Building2,
  Star,
  Music,
  CreditCard,
  FileText,
  UserCheck,
  Link2,
  Bell,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const iconClass = "h-[18px] w-[18px]";

const navSections: NavSection[] = [
  {
    title: "Campaigns & Reporting",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutGrid className={iconClass} /> },
      { label: "Campaigns", href: "/campaigns", icon: <LayoutGrid className={iconClass} /> },
      { label: "Activations", href: "/activations", icon: <Zap className={iconClass} /> },
      { label: "Calendar", href: "/calendar", icon: <Calendar className={iconClass} /> },
    ],
  },
  {
    title: "Creators & Pitching",
    items: [
      { label: "Discovery", href: "/discovery", icon: <Search className={iconClass} />, badge: "BETA" },
      { label: "Creators", href: "/creators", icon: <Users className={iconClass} /> },
      { label: "Lists", href: "/lists", icon: <List className={iconClass} /> },
    ],
  },
  {
    title: "Clients",
    items: [
      { label: "Clients", href: "/clients", icon: <Building2 className={iconClass} /> },
      { label: "Fan Pages", href: "/fan-pages", icon: <Star className={iconClass} /> },
      { label: "Trackers", href: "/trackers", icon: <Music className={iconClass} />, badge: "BETA" },
    ],
  },
  {
    title: "Financial",
    items: [
      { label: "Payouts", href: "/payouts", icon: <CreditCard className={iconClass} /> },
      { label: "Requests", href: "/requests", icon: <FileText className={iconClass} /> },
      { label: "Recipients", href: "/recipients", icon: <UserCheck className={iconClass} /> },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Connections", href: "/connections", icon: <Link2 className={iconClass} /> },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col bg-[#0A0B14] border-r border-white/[0.06] transition-all duration-300",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5">
          <span className="text-blue-500 text-lg font-black shrink-0">✦</span>
          {!collapsed && (
            <span className="text-[15px] font-black tracking-tight text-white lowercase">
              creatorcore
            </span>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mx-3 mb-2 flex items-center justify-center rounded-lg p-1.5 text-white/30 hover:bg-white/5 hover:text-white/60 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-1">
          {navSections.map((section) => (
            <div key={section.title} className="mb-5">
              {!collapsed && (
                <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/25">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all duration-200",
                        collapsed && "justify-center px-0",
                        isActive
                          ? "bg-blue-600/15 text-blue-400"
                          : "text-white/40 hover:bg-white/5 hover:text-white/70"
                      )}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      {!collapsed && <span>{item.label}</span>}
                      {!collapsed && item.badge && (
                        <span className="ml-auto rounded-full bg-blue-600/20 px-1.5 py-0.5 text-[9px] font-bold text-blue-400 uppercase">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User profile */}
        <div className="border-t border-white/[0.06] px-3 py-3">
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-[11px] font-bold text-white">
              JD
            </div>
            {!collapsed && (
              <div className="flex-1 truncate">
                <p className="text-[13px] font-semibold text-white">John Doe</p>
                <p className="text-[11px] text-white/30">Owner</p>
              </div>
            )}
            {!collapsed && (
              <button className="rounded-lg p-1.5 text-white/25 transition-colors hover:bg-white/5 hover:text-white/50">
                <Bell className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around border-t border-white/[0.06] bg-[#0A0B14]/95 backdrop-blur-xl px-2 py-2">
        {[
          { label: "Home", href: "/dashboard", icon: <LayoutGrid className="h-5 w-5" /> },
          { label: "Campaigns", href: "/campaigns", icon: <LayoutGrid className="h-5 w-5" /> },
          { label: "Creators", href: "/creators", icon: <Users className="h-5 w-5" /> },
          { label: "Payouts", href: "/payouts", icon: <CreditCard className="h-5 w-5" /> },
          { label: "More", href: "/connections", icon: <Link2 className="h-5 w-5" /> },
        ].map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors",
                isActive ? "text-blue-400" : "text-white/30"
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
