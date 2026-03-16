"use client";

import { Search, Bell, Plus } from "lucide-react";

export function TopNav() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-white/[0.06] bg-[#0C0D18] px-6">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
          <input
            placeholder="Search everything..."
            className="h-9 w-full rounded-xl bg-white/[0.04] border border-white/[0.06] pl-10 pr-4 text-sm text-white placeholder-white/25 outline-none focus:border-blue-600/40 focus:bg-white/[0.06] transition-all"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-blue-700 hover:shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all">
          <Plus className="h-3.5 w-3.5" />
          Quick Add
        </button>
        <button className="relative rounded-lg p-2 text-white/30 hover:bg-white/5 hover:text-white/60 transition-colors">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-500" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-purple-600 text-[11px] font-bold text-white">
          JD
        </div>
      </div>
    </header>
  );
}
