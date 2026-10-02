// TikTok developer webhook. The one event acted on is `authorization.removed`:
// the creator withdrew our app from their TikTok settings, so the grant is
// already dead at TikTok. It ends the connection through the same path as the
// creator pressing Disconnect (lib/portal/disconnect.ts), minus the revoke call
// that would only be refused.
//
// Register in the TikTok developer portal as
//   https://campaign.madeboring.com/api/webhooks/tiktok
// Unauthenticated by design: the TikTok-Signature header is the credential.
// Every other event is acknowledged with 200 and ignored, because TikTok
// retries anything it does not see a 200 for.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";
import {
  parseTikTokWebhookBody,
  tiktokWebhookSecrets,
  verifyTikTokSignature,
} from "@/lib/oauth/tiktokWebhook";
import { disconnectSocialAccount } from "@/lib/portal/disconnect";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const log = createLogger({ context: { route: "webhooks/tiktok" } });

  const rawBody = await req.text();
  const signature = req.headers.get("tiktok-signature");
  if (!verifyTikTokSignature(signature, rawBody, tiktokWebhookSecrets())) {
    log.warn("tiktok webhook: signature did not verify", { hasHeader: Boolean(signature) });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const event = parseTikTokWebhookBody(rawBody);
  if (!event) return NextResponse.json({ error: "malformed event" }, { status: 400 });

  if (event.event !== "authorization.removed") {
    log.info("tiktok webhook: event ignored", { event: event.event });
    return NextResponse.json({ ok: true, ignored: event.event });
  }
  if (!event.userOpenId) return NextResponse.json({ error: "user_openid missing" }, { status: 400 });

  /* No tenant on a webhook: the open_id is the whole scope, and every org that
     holds a connection for this TikTok account loses it, as the creator asked. */
  const accounts = await db.creatorSocialAccount.findMany({
    where: { platform: "TIKTOK", platformUserId: event.userOpenId },
    select: {
      id: true,
      creatorId: true,
      platform: true,
      accessToken: true,
      origin: true,
      creator: { select: { orgId: true } },
    },
  });

  /* One failure must not strand the rest. A 500 when any row failed makes
     TikTok retry, and the retry finds only the rows still there. */
  let removed = 0;
  let failed = 0;
  for (const { creator, ...account } of accounts) {
    try {
      await disconnectSocialAccount(account, creator.orgId, { alreadyRevoked: true });
      removed++;
    } catch (err) {
      failed++;
      log.error("tiktok webhook: disconnect failed", {
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("tiktok webhook: authorization removed", { removed, failed });
  if (failed > 0) return NextResponse.json({ ok: false, removed, failed }, { status: 500 });
  return NextResponse.json({ ok: true, removed });
}
