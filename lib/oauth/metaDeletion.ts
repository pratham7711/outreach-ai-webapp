// Shared by the two Meta webhooks: reading the envelope off the request and
// forgetting the user it names.

import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { toPlatformEnum, type OAuthPlatform } from "./providers";

/**
 * Meta posts `signed_request` as a form field. The JSON and query-string forms
 * are accepted too, so a manual re-drive from the App Dashboard's "test"
 * button or a curl works the same way.
 */
export async function readSignedRequest(req: NextRequest): Promise<string | null> {
  const contentType = req.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const value = form.get("signed_request");
      if (typeof value === "string" && value) return value;
    } else if (contentType.includes("application/json")) {
      const body = (await req.json()) as { signed_request?: unknown };
      if (typeof body?.signed_request === "string" && body.signed_request) return body.signed_request;
    }
  } catch {
    /* fall through to the query string */
  }
  const fromQuery = req.nextUrl.searchParams.get("signed_request");
  return fromQuery || null;
}

/**
 * Delete every linked account that belongs to this Meta user on the given
 * platforms. Returns how many rows went.
 *
 * There is no orgId here on purpose: a webhook has no tenant, and the Meta
 * user id is unique across the app, so [platform, platformUserId] is the
 * whole scope. Tokens live on the row, so deleting it revokes our access at
 * the same time.
 */
export async function forgetMetaUser(userId: string, platforms: OAuthPlatform[]): Promise<number> {
  const { count } = await db.creatorSocialAccount.deleteMany({
    where: {
      platformUserId: userId,
      platform: { in: platforms.map(toPlatformEnum) },
    },
  });
  return count;
}
