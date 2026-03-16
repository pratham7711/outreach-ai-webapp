"use client";

import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[#080910]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-y-auto bg-[#0E0F1C] p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
