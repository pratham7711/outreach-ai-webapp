"use client";

import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--cc-bg)]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav />
        <main className="flex-1 overflow-y-auto bg-[var(--cc-bg)] p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
