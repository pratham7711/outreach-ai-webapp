import { NextResponse } from "next/server";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

/**
 * The 404 every payout route gives while payouts are off (lib/payouts/switch.ts).
 *
 * Called first thing in the handler, before the session is read, so the route
 * looks the same to everyone -- signed in or not, any role -- as a route that
 * does not exist. Returns null when payouts are on, and the handler carries on
 * to its own auth and permission checks exactly as before:
 *
 *   const off = payoutsOffResponse();
 *   if (off) return off;
 */
export function payoutsOffResponse(): NextResponse | null {
  if (PAYOUTS_ENABLED) return null;
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
