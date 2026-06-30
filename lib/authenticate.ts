import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export type AuthResult = {
  orgId: string;
  userId: string | null;
  actorEmail: string | null;
  actorType: "user" | "api_key";
};

/**
 * Authenticates an incoming API request.
 *
 * Tries (in order):
 *  1. NextAuth session cookie  — dashboard users logged in via browser
 *  2. Bearer API key           — Authorization: Bearer oai_<key>
 *                                Used by MCP server plugins, Discord bots, external integrations
 *
 * Returns AuthResult on success, null on failure.
 */
export async function authenticateRequest(req?: NextRequest): Promise<AuthResult | null> {
  // 1. Try NextAuth session first
  const session = await auth();
  if (session?.user) {
    return {
      orgId: (session.user as any).orgId as string,
      userId: session.user.id ?? null,
      actorEmail: (session.user as any).email ?? null,
      actorType: "user",
    };
  }

  // 2. Try API key from Authorization header
  //    Format: Authorization: Bearer oai_<32-hex-chars>
  const authHeader = req?.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const plaintext = authHeader.slice(7).trim();
    if (plaintext.startsWith("oai_") && plaintext.length >= 36) {
      const hash = createHash("sha256").update(plaintext).digest("hex");
      const key = await db.apiKey.findUnique({
        where: { keyHash: hash },
        select: { id: true, orgId: true, name: true },
      });
      if (key) {
        // Update lastUsedAt in the background — don't block the request
        db.apiKey
          .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
        return {
          orgId: key.orgId,
          userId: null,
          actorEmail: null,
          actorType: "api_key",
        };
      }
    }
  }

  return null;
}

/**
 * Returns audit actor fields compatible with logAudit().
 * Use this instead of createAuditActor(session) in routes that use authenticateRequest().
 */
export function getAuditActor(result: AuthResult) {
  return {
    userId: result.userId ?? undefined,
    actorEmail: result.actorEmail ?? undefined,
    actorType: result.actorType,
  };
}
