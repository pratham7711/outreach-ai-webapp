"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { shellForPathname } from "@/lib/campaignSections";
import { useSidebar } from "@/components/providers/SidebarProvider";

/* The dashboard's outermost box, stamped with the shell it is drawing. Theme
   rules used to find the shell with `.cc-shell-root:has(.cc-sidebar-rail[data-shell=X])`.
   A :has() on the element that holds <main> makes Chrome restyle the whole
   shell whenever anything inside main changes: MEASURED 2026-10-02 in the
   former CreatorCore theme, 1,578 elements per change on /campaigns against
   Light's 6, and 667ms against 74ms over 400 changes. An attribute selector
   costs nothing of the kind. */
export function ShellRoot({ className, children }: { className: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const { collapsed } = useSidebar();
  return (
    <div className={className} data-shell={shellForPathname(pathname)} data-rail={collapsed ? "collapsed" : "expanded"}>
      {children}
    </div>
  );
}
