import { InstagramAuthError } from "@/lib/platforms/instagram";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { fetchInstagramAccount } from "@/lib/platforms/instagramAccount";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { readInstagramInsightsBundle, type IgInsightsBundle } from "@/lib/platforms/instagramAccountInsights";
import type { ReadableConnection } from "@/lib/creators/connectionGate";
import { createLogger } from "@/lib/observability/logger";

/**
 * Account and story insights for one creator's Instagram connection, shared by
 * the creator's own My stats (/api/portal/insights/instagram) and the agency's
 * creator page (/api/creators/[id]/instagram-insights). Both routes find the
 * connection through the grant gate first; this only reads with it.
 */

export type InstagramInsightsBody = IgInsightsBundle & {
  handle: string;
  readAt: string;
  stored: false;
};

export type InstagramInsightsRead =
  | { ok: true; body: InstagramInsightsBody }
  | { ok: false; status: number; error: string; reason: string };

const log = createLogger({ context: { platform: "INSTAGRAM", call: "insights.account" } });

export async function readInsightsForConnection(
  connection: ReadableConnection,
  orgId: string,
  now = new Date(),
): Promise<InstagramInsightsRead> {
  if (isInstagramLoginRow(connection.origin))
    return {
      ok: false,
      status: 409,
      error: "unsupported_login",
      reason: "Account insights are read for Instagram accounts connected through Facebook Login.",
    };

  const token = await ensureFreshInstagramToken(connection, orgId);
  if (!token)
    return { ok: false, status: 409, error: "reauthorize", reason: "Access to this Instagram account has lapsed. Reconnect it from My accounts." };

  try {
    const igUserId = connection.platformUserId ?? (await fetchInstagramAccount(token))?.igUserId ?? null;
    if (!igUserId)
      return {
        ok: false,
        status: 409,
        error: "no_business_account",
        reason: "No Instagram professional account is linked to the connected Facebook Page.",
      };
    const bundle = await readInstagramInsightsBundle(token, igUserId, { now });
    return { ok: true, body: { ...bundle, handle: connection.handle, readAt: now.toISOString(), stored: false } };
  } catch (err) {
    if (err instanceof InstagramAuthError) {
      log.warn("Instagram insights read rejected by Graph", { status: err.status });
      return { ok: false, status: 409, error: "reauthorize", reason: "Instagram rejected the access. Reconnect the account from My accounts." };
    }
    throw err;
  }
}
