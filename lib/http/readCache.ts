/**
 * Cache headers for read-only reporting endpoints.
 *
 * These are fetched from client components, which re-run on every mount, so
 * leaving and returning to a page re-ran the whole rollup query. The browser's
 * own cache answers the repeat instead. `private` because the payload is
 * org-scoped and must never sit in a shared cache, and thirty seconds to match
 * the client router cache window in next.config.ts. A hard refresh sends
 * no-cache and bypasses this, which is the behaviour we want.
 *
 * Deliberately NOT used on list or mutation endpoints: a campaign you just
 * created has to appear the moment you navigate back to its list.
 */
export const READ_CACHE_HEADERS = {
  "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
} as const;
