import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, type AuthResult } from "@/lib/authenticate";
import { hasPermission } from "@/lib/rbac";

export type AuthzResult =
  | { ok: true; auth: AuthResult }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  request: NextRequest | undefined,
  permission: string
): Promise<AuthzResult> {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (auth.actorType === "api_key") {
    return { ok: true, auth };
  }
  if (!auth.role || !hasPermission(auth.role, permission)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, auth };
}

/**
 * The same role check, for routes that authenticate through `auth()`.
 *
 * Several routes read the NextAuth session directly rather than going through
 * `authenticateRequest`, because they want the session user's own shape --
 * `scopeSubjectFromSession`, `session.user.id` for an audit actor. Converting
 * them to `requirePermission` would also hand them API-key authentication they
 * do not have today, which is a wider door than a permission gate is supposed
 * to open. So the rule itself stays in one place and this is the second way in
 * to it, not a second copy of it.
 *
 * Returns the 403 to return, or null when the role is allowed.
 */
export function permissionDenial(user: unknown, permission: string): NextResponse | null {
  const role = (user as { role?: unknown } | null)?.role;
  if (typeof role !== "string" || !hasPermission(role, permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
