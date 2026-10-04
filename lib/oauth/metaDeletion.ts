// Shared by the two Meta webhooks: reading the envelope off the request and
// forgetting the user it names.

import type { NextRequest } from "next/server";
import type { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import { accountIdsForGrantor } from "@/lib/platforms/accountState";
import { isGrantorPlatform } from "@/lib/platforms/metaGrantor";
import { toPlatformEnum, type OAuthPlatform } from "./providers";
import { grantTablesReady } from "@/lib/creators/grantTables";
import { REVOKE_REASONS, revokeGrantsForConnections, type RevokeReason } from "@/lib/creators/grants";
import { deleteAgencyCredentialsGrantedBy } from "@/lib/platforms/instagramAgencyCredential";

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
 * user id is unique across the app, so the user is the whole scope — two orgs
 * that rostered the same person both lose the connection, as they should.
 * Tokens live on the row, so deleting it revokes our access at the same time.
 *
 * What `userId` names depends on the platform, and so does the match:
 *
 *   - THREADS: the Threads user id, which is the platformUserId we stored.
 *     Matched exactly as it always was.
 *   - INSTAGRAM / FACEBOOK (Facebook Login): the app-scoped Facebook user who
 *     granted access. platformUserId holds the IG account or Page id instead,
 *     so that match alone deleted nothing; the grantor id recorded at connect
 *     time (CreatorAccountState) is what finds these rows. platformUserId is
 *     still accepted, so nothing that matched before stops matching. Instagram
 *     Login rows are left alone: they are a different grant, at a different
 *     app, and removing the Facebook app does not withdraw them.
 *   - instagram-login: only rows minted by Instagram Login, matched on either
 *     the account id (platformUserId) or the app-scoped id (grantor), because
 *     which one Instagram's callback sends is not something the code can know.
 *
 * Absent CreatorAccountState table: the grantor half matches nothing and this
 * behaves exactly as it did before the table existed.
 *
 * An agency's own Instagram account (Settings → Integrations) is granted
 * through the same Facebook Login app, so an Instagram-signed request also
 * removes every org's account that this user granted, and counts it.
 */
export async function forgetMetaUser(
  userId: string,
  platforms: OAuthPlatform[],
  /** For the grant record: which of Meta's two callbacks this is. */
  reason: RevokeReason = REVOKE_REASONS.META_DEAUTHORIZE,
): Promise<number> {
  if (!userId || platforms.length === 0) return 0;

  const needsGrantor = platforms.some(isGrantorPlatform);
  const grantedIds = needsGrantor ? await accountIdsForGrantor(userId) : [];
  const ownedBy: Prisma.CreatorSocialAccountWhereInput[] = [
    { platformUserId: userId },
    ...(grantedIds.length > 0 ? [{ id: { in: grantedIds } }] : []),
  ];

  const clauses: Prisma.CreatorSocialAccountWhereInput[] = [];

  const facebookLogin = platforms
    .filter((p) => p === "instagram" || p === "facebook")
    .map(toPlatformEnum);
  if (facebookLogin.length > 0) {
    clauses.push({
      platform: { in: facebookLogin },
      AND: [
        /* `origin <> x` is NULL for a NULL origin in SQL, so the legacy rows
           (origin NULL, all Facebook Login) need their own arm. */
        { OR: [{ origin: null }, { origin: { not: ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN } }] },
        { OR: ownedBy },
      ],
    });
  }

  if (platforms.includes("instagram-login")) {
    clauses.push({
      platform: toPlatformEnum("instagram-login"),
      origin: ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN,
      OR: ownedBy,
    });
  }

  if (platforms.includes("threads")) {
    clauses.push({ platformUserId: userId, platform: toPlatformEnum("threads") });
  }

  if (clauses.length === 0) return 0;
  const where = clauses.length === 1 ? clauses[0] : { OR: clauses };
  /* Every org's grant on these rows ends first, with Meta's reason on it,
     because the delete below leaves nothing to look the rows up by. Only
     asked once the grant table exists, so before it does this is the same
     single deleteMany it always was. */
  if (await grantTablesReady({ fresh: true })) {
    try {
      const rows = await db.creatorSocialAccount.findMany({ where, select: { id: true } });
      await revokeGrantsForConnections(
        rows.map((r) => r.id),
        reason,
      );
    } catch {
      /* The connection is still forgotten below; a grant left live points at
         a row that no longer exists, which the gate cannot read anyway. */
    }
  }
  const { count } = await db.creatorSocialAccount.deleteMany({ where });
  let agencies = 0;
  if (platforms.includes("instagram")) {
    try {
      agencies = (await deleteAgencyCredentialsGrantedBy(userId)).length;
    } catch {
      /* The creator rows are already gone; an agency row left behind is
         stamped rejected by its next read, as any dead token is. */
    }
  }
  return count + agencies;
}
