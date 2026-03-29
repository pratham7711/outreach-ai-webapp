"use client";

import { useSidebar } from "@/components/providers/SidebarProvider";
import type { ReactNode } from "react";

export function DashboardContent({ children }: { children: ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{
        marginLeft: 0,
        transition: "margin-left 0.2s ease",
      }}
    >
      {/* On lg+, offset by sidebar width. On mobile, no offset. */}
      <style>{`
        @media (min-width: 1024px) {
          .cc-dashboard-content {
            margin-left: ${collapsed ? 68 : 256}px !important;
          }
        }
      `}</style>
      <div className="cc-dashboard-content flex-1 flex flex-col overflow-hidden" style={{ transition: "margin-left 0.2s ease" }}>
        {children}
      </div>
    </div>
  );
}
