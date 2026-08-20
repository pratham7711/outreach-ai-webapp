"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";

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

  const push = (patch: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...patch })) {
      if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return { push, pending };
}
