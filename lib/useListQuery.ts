"use client";

import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useTransition, type CSSProperties } from "react";

type QueryValue = string | number | null | undefined;
type QueryPatch = Record<string, QueryValue>;

/**
 * URL state for server-paginated list pages (campaigns, creators).
 *
 * Takes the current values as an argument rather than reading them with
 * useSearchParams, because useSearchParams forces the caller to sit inside a
 * Suspense boundary. The server component already resolved these values and
 * passes them down as props, so reading them again buys nothing.
 *
 * Empty/null values are dropped from the query string, so the default view
 * stays on a clean URL.
 */
export function useListQuery(current: Record<string, string | number | undefined>) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  /* Until this existed a click reported nothing back. MEASURED 2026-10-13 on a
     dev server against the demo org, sampling every frame after the click: a
     /campaigns status tab kept the OLD tab highlighted for 1,065-3,740ms, the
     sort select kept the old field for over 4s, and the list sat unchanged
     until the server's page arrived and everything moved at once. Read from the
     screen, the click had missed, so people click again.

     `shown` is the query with the click already applied, for the controls to
     draw from. It lasts only as long as the navigation: React drops it when the
     transition settles, after which the controls read the server's own values
     again and cannot disagree with the list beneath them. The request itself is
     untouched -- same URL, same router.replace. */
  const [shown, show] = useOptimistic<QueryPatch, QueryPatch>(current, (state, patch) => ({ ...state, ...patch }));

  const push = (patch: QueryPatch) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...patch })) {
      if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    startTransition(() => {
      show(patch);
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return { push, pending, shown };
}

/**
 * For the element holding a list's results while a navigation is in flight.
 *
 * The rows on screen still belong to the previous query, so they are dimmed
 * and marked busy rather than hidden: hiding them would jump the page, and
 * they stay readable and clickable. The dim waits 150ms before starting, so a
 * navigation that answers at once does not flicker.
 */
export function pendingListProps(pending: boolean): { "aria-busy"?: true; style?: CSSProperties } {
  return pending
    ? { "aria-busy": true, style: { opacity: 0.55, transition: "opacity 150ms ease 150ms" } }
    : {};
}
