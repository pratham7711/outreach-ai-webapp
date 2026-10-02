"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { shellForPathname } from "@/lib/campaignSections";

/* The dashboard's outermost box, stamped with the shell it is drawing. Theme
   rules used to find the shell with `.cc-shell-root:has(.cc-sidebar-rail[data-shell=X])`.
   A :has() on the element that holds <main> makes Chrome restyle the whole
   shell whenever anything inside main changes: MEASURED 2026-10-02 in the
   creatorcore theme, 1,578 elements per change on /campaigns against Light's 6,
   and 667ms against 74ms over 400 changes. An attribute selector costs nothing
   of the kind. */
export function ShellRoot({ className, children }: { className: string; children: ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className={className} data-shell={shellForPathname(pathname)}>
      {children}
    </div>
  );
}
