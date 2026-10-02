const DEFAULT_RETURN = "/portal/settings";

// Only same-site portal paths may be echoed back after OAuth, otherwise the
// connect link becomes an open redirect.
//
// The one other destination is a connect-link page, /connect/<token>, which a
// signed-out creator starts from and must land back on. Matched exactly — the
// token's own alphabet and length, no further path — so it opens nothing else.
const CONNECT_RETURN = /^\/connect\/[A-Za-z0-9_-]{43}$/;

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/portal/") && !CONNECT_RETURN.test(raw)) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}

export function returnToWithQuery(raw: string | null | undefined, query: string): string {
  const base = safeReturnTo(raw) ?? DEFAULT_RETURN;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}
