/**
 * Letting a platform operator open a tenant's own screens.
 *
 * /platform answers "how is every agency doing" from aggregates. It cannot
 * answer "why does this campaign show no views", because that needs the
 * campaign's own screen, and every query in this codebase takes orgId from the
 * session. So the switch is made where the session is read rather than at 66
 * call sites: an operator picks an org, and from then on their session reports
 * that org as its own.
 *
 * Three rules this file exists to keep.
 *
 * NOT IN THE JWT. The token's orgId is re-read from the user's row once a
 * minute (see the jwt callback in lib/auth.ts), so an orgId written into the
 * token is silently reverted mid-session -- the same trap that made synthetic
 * roles fail open. The switch lives in its own cookie and is applied after the
 * token is decoded, every request.
 *
 * RE-AUTHORISED EVERY REQUEST. The cookie is a request, not a grant: it is
 * honoured only while the signed-in address is still on the allowlist. Anyone
 * else holding the same cookie -- including a tenant who copied it -- gets
 * their own org, because isPlatformAdmin is checked here and not at the door.
 *
 * MODE IS EXPLICIT. There is no "obvious" default between looking and editing
 * inside someone else's workspace, so the caller must say which, and the audit
 * row records which was asked for.
 */

import { db } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/billing/subscription";

export const ACT_AS_COOKIE = "cc-act-as";

/** Bounded so a forgotten switch expires instead of following an operator around. */
export const ACT_AS_MAX_AGE_SECONDS = 4 * 60 * 60;

/**
 * What the operator may do inside the tenant.
 *
 * Mapped onto the roles the product already has rather than a new one, so the
 * permission table stays the only place access is described. "read" is VIEWER,
 * which is the app's own read-only seat; "full" is OWNER, the seat that can
 * repair whatever was wrong.
 */
export type ActAsMode = "read" | "full";

export const ACT_AS_ROLE: Record<ActAsMode, "VIEWER" | "OWNER"> = {
  read: "VIEWER",
  full: "OWNER",
};

export type ActingAs = {
  orgId: string;
  orgName: string;
  mode: ActAsMode;
  /** The operator's real org, so the banner can offer the way back. */
  homeOrgId: string | null;
};

export function encodeActAs(orgId: string, mode: ActAsMode): string {
  return `${orgId}|${mode}`;
}

/** Null for anything that is not a well-formed switch, so a junk cookie is inert. */
export function parseActAs(raw: string | null | undefined): { orgId: string; mode: ActAsMode } | null {
  if (!raw) return null;
  const [orgId, mode] = raw.split("|");
  if (!orgId || (mode !== "read" && mode !== "full")) return null;
  return { orgId, mode };
}

type SessionLike = {
  user?: {
    email?: string | null;
    orgId?: string;
    role?: string;
    campaignScope?: string;
    actingAs?: ActingAs;
    [key: string]: unknown;
  } | null;
} | null;

/**
 * The org a session should be read as, given the cookie it arrived with.
 *
 * Separated from the cookie jar so it can be tested without a request: the jar
 * is read by the caller in lib/auth.ts, which is the only place that has one.
 */
export async function resolveActAs(
  email: string | null | undefined,
  cookieValue: string | null | undefined,
  homeOrgId: string | null,
): Promise<ActingAs | null> {
  if (!isPlatformAdmin(email)) return null;
  const parsed = parseActAs(cookieValue);
  if (!parsed) return null;
  // Acting as your own org is not acting at all, and a banner saying so would
  // be noise on every page of the operator's own workspace.
  if (parsed.orgId === homeOrgId) return null;

  const org = await db.organization.findUnique({
    where: { id: parsed.orgId },
    select: { id: true, name: true },
  });
  // A deleted org leaves the operator in their own workspace rather than in a
  // session pointing at nothing, which renders as a dashboard full of holes.
  if (!org) return null;

  return { orgId: org.id, orgName: org.name, mode: parsed.mode, homeOrgId };
}

/**
 * Rewrites a decoded session to the org being acted as. A no-op for everyone
 * else, which is why lib/auth.ts can apply it unconditionally.
 *
 * campaignScope is forced to ALL: the operator's own scope describes which
 * campaigns they are assigned to in THEIR org, and carrying an "assigned only"
 * setting into somebody else's workspace would hide every campaign there and
 * read as an empty tenant.
 */
export function applyActingAs<T extends SessionLike>(session: T, acting: ActingAs | null): T {
  if (!session?.user || !acting) return session;
  const user = session.user;
  user.orgId = acting.orgId;
  user.role = ACT_AS_ROLE[acting.mode];
  user.campaignScope = "ALL";
  user.actingAs = acting;
  return session;
}
