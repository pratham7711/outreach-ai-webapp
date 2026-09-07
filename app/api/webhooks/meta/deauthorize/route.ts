// Meta "Deauthorize Callback": fired when a user removes the app from their
// Instagram / Facebook / Threads settings. Their access token is dead from that
// moment, so the only correct response is to forget the account — anything else
// leaves a row that will fail on its next sync and show "Reconnect" forever.
//
// Registered in the Meta App Dashboard as
//   https://campaign.madeboring.com/api/webhooks/meta/deauthorize
// (Threads: "Uninstall Callback URL"). Unauthenticated by design: the request
// proves itself with the app-secret signature, not a session.

import { NextRequest, NextResponse } from "next/server";
import { verifyMetaSignedRequest } from "@/lib/oauth/metaSignedRequest";
import { forgetMetaUser, readSignedRequest } from "@/lib/oauth/metaDeletion";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "webhooks/meta/deauthorize" } });

  const signedRequest = await readSignedRequest(req);
  if (!signedRequest) return NextResponse.json({ error: "signed_request missing" }, { status: 400 });

  const verified = verifyMetaSignedRequest(signedRequest);
  if (!verified) {
    log.warn("deauthorize: signature did not verify against any Meta app secret");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const userId = typeof verified.payload.user_id === "string" ? verified.payload.user_id : null;
  if (!userId) return NextResponse.json({ error: "user_id missing" }, { status: 400 });

  const removed = await forgetMetaUser(userId, verified.platforms);
  log.info("deauthorize: forgot Meta user", { platforms: verified.platforms, removed });
  return NextResponse.json({ ok: true, removed });
}
