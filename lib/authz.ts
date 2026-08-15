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
