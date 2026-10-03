"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { announceNavigation } from "@/components/layout/NavigationProgress";

type NavLinkProps = Omit<ComponentProps<typeof Link>, "href" | "ref"> & { href: string };

/**
 * A Link that tells NavigationProgress when the router has taken the click.
 * onNavigate fires only for a client-side navigation the router actually
 * starts -- not for a modified click, a download, or an external URL -- so the
 * progress bar and its reload fallback never follow a click that went
 * somewhere else.
 */
export function NavLink({ href, onNavigate, ...props }: NavLinkProps) {
  return (
    <Link
      {...props}
      href={href}
      onNavigate={(e) => {
        let handled = false;
        onNavigate?.({
          preventDefault: () => {
            handled = true;
            e.preventDefault();
          },
        });
        if (!handled) announceNavigation(href);
      }}
    />
  );
}
