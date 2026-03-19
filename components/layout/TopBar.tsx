"use client";

import { usePathname } from "next/navigation";
import { Search, Bell } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/campaigns": "Campaigns",
  "/activations": "Activations",
  "/calendar": "Calendar",
  "/creators": "Creators",
  "/lists": "Lists",
  "/discovery": "Discovery",
  "/payouts": "Payouts",
  "/clients": "Clients",
  "/trackers": "Trackers",
  "/connections": "Connections",
  "/reports": "Reports",
  "/media-kits": "Media Kits",
  "/settings": "Settings",
  "/analytics": "Analytics",
};

export function TopBar() {
  const pathname = usePathname();
  const segment = "/" + (pathname.split("/")[1] ?? "dashboard");
  const title = PAGE_TITLES[segment] ?? "Dashboard";

  return (
    <header className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-[#2A2A3A] bg-[#0D0D14]/80 backdrop-blur-md">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[#555577]">Pages</span>
        <span className="text-[#555577]">/</span>
        <span className="text-[#F0F0FF] font-medium">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <button className="p-2 rounded-lg text-[#8888AA] hover:text-[#F0F0FF] hover:bg-white/5 transition-colors">
          <Search className="h-4 w-4" />
        </button>
        <button className="p-2 rounded-lg text-[#8888AA] hover:text-[#F0F0FF] hover:bg-white/5 transition-colors relative">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-primary)]" />
        </button>
        <div className="ml-2 w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-purple-600 flex items-center justify-center text-white text-xs font-bold">
          A
        </div>
      </div>
    </header>
  );
}
