import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import {
  AGENCY_IG_STATE_COOKIE,
  agencyStateCookieValue,
  buildAgencyAuthorizeUrl,
} from "@/lib/platforms/instagramAgencyConnect";

const SETTINGS_PATH = "/settings/integrations";

/**
 * Starts Facebook Login for the org's own Instagram professional account.
 * A full-page navigation from the Connect button, so every refusal goes back
 * to the settings page with a reason rather than answering JSON.
 */
export async function GET(req: NextRequest) {
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`${SETTINGS_PATH}?instagram=error&reason=${reason}`, req.url));

  const session = await auth();
  if (!session?.user) return NextResponse.redirect(new URL("/login", req.url));
  const role = (session.user as any).role as string;
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId || !hasPermission(role, "settings:*")) return back("forbidden");

  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildAgencyAuthorizeUrl(state);
  if (!authorizeUrl) return back("provider");

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(AGENCY_IG_STATE_COOKIE, agencyStateCookieValue(state, orgId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
