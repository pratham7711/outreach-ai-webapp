// Meta "Data Deletion Request Callback": a user asked Meta to have their data
// deleted from this app. Meta expects a JSON reply with a status URL and a
// confirmation code, and the user may later visit that URL to check on it, so
// the URL is the human-readable /data-deletion page; GET here answers the same
// status as JSON.
//
// Registered in the Meta App Dashboard as
//   https://campaign.madeboring.com/api/webhooks/meta/data-deletion
// (Threads: "Delete Callback URL").
//
// Deletion is synchronous — the linked-account rows, tokens included, are gone
// before we answer — so the status endpoint has nothing to poll. What it does
// report is what actually happened: the confirmation code records whether any
// rows were deleted, and a request that matched nothing is not told its data
// was deleted. Unauthenticated by design; the signature is the credential.

import { NextRequest, NextResponse } from "next/server";
import { deletionConfirmationCode, verifyMetaSignedRequest } from "@/lib/oauth/metaSignedRequest";
import { metaDeletionStatus } from "@/lib/oauth/metaDeletionStatus";
import { clientSecretFor } from "@/lib/oauth/providers";
import { forgetMetaUser, readSignedRequest } from "@/lib/oauth/metaDeletion";
import { createLogger } from "@/lib/observability/logger";
import { REVOKE_REASONS } from "@/lib/creators/grants";

export const dynamic = "force-dynamic";

function statusUrl(req: NextRequest, code: string): string {
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/+$/, "");
  return `${base}/data-deletion?code=${encodeURIComponent(code)}`;
}

export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "webhooks/meta/data-deletion" } });

  const signedRequest = await readSignedRequest(req);
  if (!signedRequest) return NextResponse.json({ error: "signed_request missing" }, { status: 400 });

  const verified = verifyMetaSignedRequest(signedRequest);
  if (!verified) {
    log.warn("data-deletion: signature did not verify against any Meta app secret");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const userId = typeof verified.payload.user_id === "string" ? verified.payload.user_id : null;
  if (!userId) return NextResponse.json({ error: "user_id missing" }, { status: 400 });

  const removed = await forgetMetaUser(userId, verified.platforms, REVOKE_REASONS.META_DATA_DELETION);

  // Every platform in `verified.platforms` shares the secret that verified, so
  // any of them yields the same code.
  const secret = clientSecretFor(verified.platforms[0]) ?? "";
  const code = deletionConfirmationCode(userId, secret, removed > 0 ? "deleted" : "none");
  log.info("data-deletion: forgot Meta user", { platforms: verified.platforms, removed });

  return NextResponse.json({ url: statusUrl(req, code), confirmation_code: code });
}

/** Status check for a confirmation code, as JSON. The URL we hand Meta is the
    /data-deletion page, which reads the same status for a person. */
export async function GET(req: NextRequest) {
  const status = metaDeletionStatus(req.nextUrl.searchParams.get("code") ?? "");
  if (!status) {
    return NextResponse.json({ error: "unknown confirmation code" }, { status: 404 });
  }
  return NextResponse.json(status);
}
