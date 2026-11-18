import { headers } from "next/headers";
import { BRAND } from "@/lib/brand";

/** The origin a request reached us on, from its Host (or the proxy's forwarded host). */
export function originFromHeaders(h: Pick<Headers, "get">): string {
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(BRAND.url).origin;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

/** The origin this page was requested on, so links name the host the visitor is on. */
export async function requestOrigin(): Promise<string> {
  return originFromHeaders(await headers());
}
