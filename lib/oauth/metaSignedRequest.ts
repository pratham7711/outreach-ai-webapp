// Meta's `signed_request` — the envelope every Deauthorize and Data Deletion
// callback arrives in. Format: `<base64url(sig)>.<base64url(json)>`, where sig
// is HMAC-SHA256 over the *encoded* payload string, keyed with the app secret.
//
// One handler serves three platforms because a single Meta app may back both
// Instagram and Facebook (they then share a secret) while Threads is always a
// separate app with its own. Verification therefore tries each distinct secret
// and reports every platform that resolves to the one that matched, so a
// shared-app request forgets the user on both platforms it could have linked.

import { createHmac, timingSafeEqual } from "crypto";
import { clientSecretFor, type OAuthPlatform } from "./providers";

export const META_PLATFORMS: readonly OAuthPlatform[] = ["instagram", "facebook", "threads"];

export type MetaSignedPayload = {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
};

function base64UrlDecode(input: string): Buffer {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Verify and decode one signed_request against one secret.
 * Returns null on any failure — malformed envelope, bad signature, unparseable
 * payload, or an algorithm we did not sign with — so callers cannot act on an
 * unverified user id by accident.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): MetaSignedPayload | null {
  const dot = signedRequest.indexOf(".");
  if (dot <= 0 || dot === signedRequest.length - 1) return null;

  const sig = base64UrlDecode(signedRequest.slice(0, dot));
  const encodedPayload = signedRequest.slice(dot + 1);
  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
    if (!payload || typeof payload !== "object") return null;
    if (
      typeof payload.algorithm === "string" &&
      payload.algorithm.toUpperCase() !== "HMAC-SHA256"
    )
      return null;
    return payload as MetaSignedPayload;
  } catch {
    return null;
  }
}

/** Build a signed_request exactly as Meta does — for tests and local checks. */
export function signRequest(payload: Record<string, unknown>, appSecret: string): string {
  const encodedPayload = base64UrlEncode(
    JSON.stringify({ algorithm: "HMAC-SHA256", ...payload }),
  );
  const sig = createHmac("sha256", appSecret).update(encodedPayload).digest();
  return `${base64UrlEncode(sig)}.${encodedPayload}`;
}

export type VerifiedMetaRequest = {
  payload: MetaSignedPayload;
  /** Every platform whose configured secret is the one that verified. */
  platforms: OAuthPlatform[];
};

/**
 * Verify a signed_request against every configured Meta secret.
 *
 * Distinct secrets are tried once each; platforms sharing a secret are
 * reported together. Returns null when nothing verifies, including when no
 * Meta platform is configured at all.
 */
export function verifyMetaSignedRequest(signedRequest: string): VerifiedMetaRequest | null {
  const bySecret = new Map<string, OAuthPlatform[]>();
  for (const platform of META_PLATFORMS) {
    const secret = clientSecretFor(platform);
    if (!secret) continue;
    bySecret.set(secret, [...(bySecret.get(secret) ?? []), platform]);
  }
  for (const [secret, platforms] of bySecret) {
    const payload = parseSignedRequest(signedRequest, secret);
    if (payload) return { payload, platforms };
  }
  return null;
}

/**
 * The confirmation code handed back to Meta for a deletion request.
 *
 * Deletion runs synchronously inside the callback, so there is no job to look
 * up later; the code is instead an HMAC of the user id under the same app
 * secret, which lets the status endpoint recognise a code it issued without a
 * table of them. The user id travels in the clear because Meta already holds
 * it — it is the very id it sent us.
 */
export function deletionConfirmationCode(userId: string, appSecret: string): string {
  const mac = createHmac("sha256", appSecret).update(`meta-deletion:${userId}`).digest("hex");
  return `${userId}-${mac.slice(0, 16)}`;
}

/** True when `code` is one deletionConfirmationCode() would have issued. */
export function isDeletionConfirmationCode(code: string): boolean {
  const dash = code.lastIndexOf("-");
  if (dash <= 0) return false;
  const userId = code.slice(0, dash);
  const secrets = new Set(
    META_PLATFORMS.map((p) => clientSecretFor(p)).filter((s): s is string => Boolean(s)),
  );
  for (const secret of secrets) {
    const expected = Buffer.from(deletionConfirmationCode(userId, secret));
    const given = Buffer.from(code);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return true;
  }
  return false;
}
