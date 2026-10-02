// TikTok's webhook envelope: verifying it, and reading the one event we act on.
//
// The signature scheme is TikTok's documented one for developer webhooks. It is
// not written down anywhere in this repo, so it is implemented from TikTok's
// developer docs ("Webhooks" → "Verifying webhook signatures"):
//
//   TikTok-Signature: t=<unix seconds>,s=<hex HMAC-SHA256>
//   signed payload:   `${t}.${rawBody}`
//   key:              the app's client secret
//
// The raw body must be the exact bytes TikTok sent — re-serialising parsed JSON
// changes whitespace and breaks the MAC — which is why the route reads text.

import { createHmac, timingSafeEqual } from "crypto";

/**
 * How old a signature may be. Generous on purpose: it exists to stop a
 * captured request being replayed days later (against an account the creator
 * has since reconnected), not to reject TikTok's own retries or a skewed clock.
 */
export const TIKTOK_SIGNATURE_TOLERANCE_SEC = 60 * 60;

/**
 * Every client secret a webhook may be signed with: the production app's and,
 * when staged, the sandbox app's (TIKTOK_USE_SANDBOX swaps which one OAuth
 * uses, but a webhook from either app is ours). Read here rather than through
 * clientCredentialsFor, which returns only the pair currently in use.
 */
export function tiktokWebhookSecrets(): string[] {
  const secrets = [process.env.TIKTOK_CLIENT_SECRET, process.env.TIKTOK_SANDBOX_CLIENT_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));
  return [...new Set(secrets)];
}

function parseSignatureHeader(header: string): { t: string; s: string } | null {
  let t: string | null = null;
  let s: string | null = null;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") t = value;
    else if (key === "s") s = value;
  }
  if (!t || !s || !/^\d+$/.test(t) || !/^[0-9a-fA-F]+$/.test(s)) return null;
  return { t, s: s.toLowerCase() };
}

/** Build a header exactly as TikTok does — for tests and local checks. */
export function signTikTokWebhook(rawBody: string, secret: string, t: number): string {
  const sig = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},s=${sig}`;
}

/**
 * True when the header is a valid TikTok signature over this exact body under
 * one of `secrets`, and is no older (or newer) than the tolerance. Never throws.
 */
export function verifyTikTokSignature(
  header: string | null | undefined,
  rawBody: string,
  secrets: string[],
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec: number = TIKTOK_SIGNATURE_TOLERANCE_SEC,
): boolean {
  if (!header || secrets.length === 0) return false;
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(nowSec - Number(parsed.t)) > toleranceSec) return false;

  const given = Buffer.from(parsed.s, "hex");
  for (const secret of secrets) {
    const expected = createHmac("sha256", secret).update(`${parsed.t}.${rawBody}`).digest();
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}

export type TikTokWebhookEvent = {
  event: string;
  /** The creator's open_id — what accountSync stores as platformUserId. */
  userOpenId: string | null;
  createTime: number | null;
};

/** The fields we use from a verified body, or null when it is not an event. */
export function parseTikTokWebhookBody(rawBody: string): TikTokWebhookEvent | null {
  try {
    const body = JSON.parse(rawBody) as Record<string, unknown>;
    if (!body || typeof body !== "object" || typeof body.event !== "string") return null;
    return {
      event: body.event,
      userOpenId:
        typeof body.user_openid === "string" && body.user_openid ? body.user_openid : null,
      createTime: typeof body.create_time === "number" ? body.create_time : null,
    };
  } catch {
    return null;
  }
}
