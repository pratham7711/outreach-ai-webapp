// Meta "Data Deletion Request Callback": a user asked Meta to have their data
// deleted from this app. Meta expects a JSON reply with a status URL and a
// confirmation code, and the user may later visit that URL to check on it.
//
// Registered in the Meta App Dashboard as
//   https://campaign.madeboring.com/api/webhooks/meta/data-deletion
// (Threads: "Delete Callback URL").
//
// Deletion is synchronous — the linked-account rows, tokens included, are gone
// before we answer — so the status endpoint has nothing to poll and reports
// "complete" for any code this app issued. Unauthenticated by design; the
// signature is the credential.

import { NextRequest, NextResponse } from "next/server";
import {
  deletionConfirmationCode,
  isDeletionConfirmationCode,
  verifyMetaSignedRequest,
} from "@/lib/oauth/metaSignedRequest";
import { clientSecretFor } from "@/lib/oauth/providers";
import { forgetMetaUser, readSignedRequest } from "@/lib/oauth/metaDeletion";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

function statusUrl(req: NextRequest, code: string): string {
  const base = (process.env.APP_URL || process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/+$/, "");
  return `${base}/api/webhooks/meta/data-deletion?code=${encodeURIComponent(code)}`;
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

  const removed = await forgetMetaUser(userId, verified.platforms);

  // Every platform in `verified.platforms` shares the secret that verified, so
  // any of them yields the same code.
  const secret = clientSecretFor(verified.platforms[0]) ?? "";
  const code = deletionConfirmationCode(userId, secret);
  log.info("data-deletion: forgot Meta user", { platforms: verified.platforms, removed });

  return NextResponse.json({ url: statusUrl(req, code), confirmation_code: code });
}

/** Status check for a confirmation code — the URL we hand back above. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") ?? "";
  if (!code || !isDeletionConfirmationCode(code)) {
    return NextResponse.json({ error: "unknown confirmation code" }, { status: 404 });
  }
  return NextResponse.json({
    confirmation_code: code,
    status: "complete",
    detail:
      "All linked-account data and access tokens for this account were deleted when the request was received.",
  });
}
