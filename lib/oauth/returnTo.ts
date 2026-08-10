const DEFAULT_RETURN = "/portal/settings";

// Only same-site portal paths may be echoed back after OAuth, otherwise the
// connect link becomes an open redirect.
export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/portal/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}

export function returnToWithQuery(raw: string | null | undefined, query: string): string {
  const base = safeReturnTo(raw) ?? DEFAULT_RETURN;
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}
