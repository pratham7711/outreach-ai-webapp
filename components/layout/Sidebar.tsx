"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  BarChart3,
  Megaphone,
  Zap,
  Calendar,
  Users,
  List,
  Compass,
  DollarSign,
  Building2,
  Activity,
  Network,
  FileText,
  BookOpen,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const ic = "h-[18px] w-[18px]";

const navSections: NavSection[] = [
  {
    title: "OVERVIEW",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className={ic} /> },
      { label: "Analytics", href: "/analytics", icon: <BarChart3 className={ic} /> },
    ],
  },
  {
    title: "CAMPAIGNS",
    items: [
      { label: "Campaigns", href: "/campaigns", icon: <Megaphone className={ic} /> },
      { label: "Activations", href: "/activations", icon: <Zap className={ic} /> },
      { label: "Calendar", href: "/calendar", icon: <Calendar className={ic} /> },
    ],
  },
  {
    title: "CREATORS",
    items: [
      { label: "Creators", href: "/creators", icon: <Users className={ic} /> },
      { label: "Lists", href: "/lists", icon: <List className={ic} /> },
      { label: "Discovery", href: "/discovery", icon: <Compass className={ic} /> },
    ],
  },
  {
    title: "FINANCE",
    items: [
      { label: "Payouts", href: "/payouts", icon: <DollarSign className={ic} /> },
      { label: "Clients", href: "/clients", icon: <Building2 className={ic} /> },
    ],
  },
  {
    title: "TOOLS",
    items: [
      { label: "Trackers", href: "/trackers", icon: <Activity className={ic} /> },
      { label: "Connections", href: "/connections", icon: <Network className={ic} /> },
      { label: "Reports", href: "/reports", icon: <FileText className={ic} /> },
      { label: "Media Kits", href: "/media-kits", icon: <BookOpen className={ic} /> },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      { label: "Settings", href: "/settings", icon: <Settings className={ic} /> },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          "hidden md:flex h-screen flex-col bg-[#0D0D14] border-r border-[#2A2A3A] transition-all duration-300 shrink-0",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 h-14 shrink-0 border-b border-[#2A2A3A]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--color-primary)] to-purple-500 flex items-center justify-center shrink-0">
            <Megaphone className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-bold text-white tracking-tight">CampaignHub</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                PRO
              </span>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mx-3 mt-2 mb-1 flex items-center justify-center rounded-lg p-1.5 text-[#555577] hover:bg-white/5 hover:text-[#8888AA] transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-1">
          {navSections.map((section) => (
            <div key={section.title} className="mb-1">
              {!collapsed && (
                <p className="text-[10px] uppercase tracking-widest text-[#555577] px-3 mt-4 mb-1 font-medium">
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
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                        collapsed && "justify-center px-2",
                        isActive
                          ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-r-2 border-[var(--color-primary)]"
                          : "text-[#8888AA] hover:text-white hover:bg-white/5"
                      )}
                    >
                      <span className="shrink-0">{item.icon}</span>
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User area */}
        <div className="border-t border-[#2A2A3A] px-3 py-3">
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              AD
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white truncate">Admin Demo</p>
                <p className="text-[11px] text-[#555577] truncate">admin@demo.com</p>
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="flex items-center justify-between mt-2">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                OWNER
              </span>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-[#555577] hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden items-center justify-around border-t border-[#2A2A3A] bg-[#0D0D14]/95 backdrop-blur-xl px-2 py-2">
        {[
          { label: "Home", href: "/dashboard", icon: <LayoutDashboard className="h-5 w-5" /> },
          { label: "Campaigns", href: "/campaigns", icon: <Megaphone className="h-5 w-5" /> },
          { label: "Creators", href: "/creators", icon: <Users className="h-5 w-5" /> },
          { label: "Payouts", href: "/payouts", icon: <DollarSign className="h-5 w-5" /> },
          { label: "More", href: "/settings", icon: <Settings className="h-5 w-5" /> },
        ].map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors",
                isActive ? "text-[var(--color-primary)]" : "text-[#555577]"
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
