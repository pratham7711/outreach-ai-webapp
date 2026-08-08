"use client";

import { useSidebar } from "@/components/providers/SidebarProvider";
import type { ReactNode } from "react";

export function DashboardContent({ children }: { children: ReactNode }) {
  const { collapsed, ready } = useSidebar();

  return (
    <div
      className="cc-dashboard-content flex flex-1 flex-col overflow-hidden"
      data-collapsed={collapsed}
      data-ready={ready}
    >
      {children}
    </div>
  );
}
