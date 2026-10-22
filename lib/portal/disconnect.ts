import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto/encrypt";
import { revokeTikTokToken } from "@/lib/platforms/tiktokDisplay";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { revokeInstagramToken } from "@/lib/platforms/instagramAccount";
import { revokeYouTubeToken } from "@/lib/platforms/youtube";
import { revokeFacebookToken } from "@/lib/platforms/facebookPage";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { accountIdsForGrantor, accountStatesFor } from "@/lib/platforms/accountState";
import { fetchMetaGrantorId } from "@/lib/platforms/metaGrantor";
import { otherAgencyGrantors } from "@/lib/platforms/instagramAgencyCredential";
import { operatorTokenGrantedBy } from "@/lib/platforms/instagramAgencyConnect";
import { REVOKE_REASONS, revokeGrantsForConnections, type RevokeReason } from "@/lib/creators/grants";
import { forgetConnectedReadings } from "@/lib/creators/forgetConnectedReadings";

/**
 * Disconnect: revoke at the platform where one can, then delete the row.
 *
 * One path for every way a connection ends — the creator pressing Disconnect
 * (DELETE /api/portal/connections) and TikTok telling us the creator removed
 * the app (POST /api/webhooks/tiktok, authorization.removed) — so the two can
 * never drift into different ideas of what "disconnected" leaves behind.
 *
 * Authorisation is the caller's job: this trusts that `account` may be ended.
 */
export type DisconnectableAccount = {
  id: string;
  creatorId: string;
  platform: string;
  accessToken: string;
  origin: string | null;
  /** TikTok only: lets a revoke refresh the access token first. A caller that
   *  leaves these out revokes with the stored token, as before. */
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
};

export async function disconnectSocialAccount(
  account: DisconnectableAccount,
  orgId: string,
  options: {
    /** The platform has already withdrawn the grant (a deauthorize webhook),
     *  so there is nothing left to revoke and no call is made. */
    alreadyRevoked?: boolean;
    /** Why, for the grant record. The creator pressing Disconnect unless the
     *  caller says otherwise (a webhook names its own event). */
    revokeReason?: RevokeReason;
  } = {},
): Promise<void> {
  if (!options.alreadyRevoked) await revokeAtPlatform(account, orgId);
  /* The grant ends before the row goes, and outlives it: the row is the
     connection, the grant is the record that this org was allowed to read it
     and when that stopped (lib/creators/grants). Never throws. */
  await revokeGrantsForConnections([account.id], options.revokeReason ?? REVOKE_REASONS.DISCONNECT);
  /* What the tracker copied from this connection goes with it, before the row
     and not after: if this throws, the row stays and the disconnect is retried
     (the creator presses again, the purge runs tomorrow, TikTok resends). */
  await forgetConnectedReadings(account.creatorId, account.platform);
  await db.creatorSocialAccount.delete({ where: { id: account.id } });
}

async function revokeAtPlatform(account: DisconnectableAccount, orgId: string): Promise<void> {
  /* Disconnect has to mean disconnected at the platform too, not just a
     forgotten row — otherwise our grant on the creator's account outlives
     the connection they revoked. This ran for TikTok alone; Instagram and
     YouTube both have a revoke endpoint and neither was being called.

     A failure here still lets the creator disconnect: their intent is
     unambiguous, and a row we keep because the platform's revoke endpoint
     was down is the worse outcome. */
  /* Instagram and Facebook are ONE grant at Meta: both rows hold a user token
     from the same app, and their revoke is DELETE /me/permissions, which
     drops every permission the app holds for that user. Revoking for the
     Facebook row therefore invalidated the Instagram token on the spot
     (measured on prod 2026-09-07: Graph code 190 "session has been
     invalidated" on the very next Instagram read). So the Graph revoke runs
     only when this is the creator's LAST Meta row; until then the row and its
     token are simply deleted here, and the grant is withdrawn at Meta when
     the last one goes. */
  const META_PLATFORMS = ["INSTAGRAM", "FACEBOOK"] as const;
  /* An Instagram-Login row is NOT part of the Facebook grant. It was minted
     by a different app id on a different host and has no me/permissions
     endpoint, so it must neither be revoked through Facebook nor counted as a
     sibling that keeps the Facebook grant alive — counting it would suppress
     the real revoke and leave the Facebook grant standing after the creator
     disconnected their last Page. */
  const isIgLogin = isInstagramLoginRow(account.origin);
  const isMeta =
    !isIgLogin && (META_PLATFORMS as readonly string[]).includes(account.platform);
  const siblingMetaRows = isMeta
    ? await db.creatorSocialAccount.count({
        where: {
          creatorId: account.creatorId,
          platform: { in: [...META_PLATFORMS] },
          id: { not: account.id },
          OR: [{ origin: null }, { origin: { not: "oauth_instagram_login" } }],
        },
      })
    : 0;

  try {
    const token = decrypt(account.accessToken, orgId);
    /* TikTok's revoke wants a live access token, and those last 24 hours: a
       connection nobody has read for a day held an expired one, so the revoke
       failed into the catch below and the grant stayed in the creator's TikTok
       settings after we told them it was gone. Refreshed first; the stored
       token is the fallback when no refresh is possible. */
    if (account.platform === "TIKTOK") {
      const fresh = await ensureFreshTikTokToken(
        {
          id: account.id,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken ?? null,
          tokenExpiry: account.tokenExpiry ?? null,
        },
        orgId,
      );
      await revokeTikTokToken(fresh ?? token);
    }
    /* Instagram Login publishes no revoke endpoint, so there is nothing to
       call — see revokeInstagramLoginToken. Deliberately not routed to
       revokeInstagramToken: that DELETEs me/permissions on graph.facebook.com
       and would 400 against a token that host does not govern, which this
       catch swallows. The row is still deleted below and the creator
       withdraws the app from Instagram's own settings, exactly as with
       Threads. */
    else if (isIgLogin) {
      // no-op by design
    } else if (account.platform === "INSTAGRAM" && siblingMetaRows === 0) {
      if (!(await metaGrantHeldElsewhere(account, token))) await revokeInstagramToken(token);
    } else if (account.platform === "YOUTUBE") await revokeYouTubeToken(token);
    else if (account.platform === "FACEBOOK" && siblingMetaRows === 0) {
      if (!(await metaGrantHeldElsewhere(account, token))) await revokeFacebookToken(token);
    }
    /* THREADS is deliberately absent: the Threads API publishes no revoke
       endpoint, so there is nothing to call. Deleting the row is the whole of
       what we can do, and the creator withdraws the grant from their own
       Threads settings. Do not add a DELETE /me/permissions here — that is
       the Facebook host and it does not govern a Threads token. */
  } catch {
    // A revoke that fails must not block the creator from disconnecting.
  }
}

/**
 * The siblings check above only sees this creator's own rows, but
 * DELETE /me/permissions ends everything the Facebook user gave the app: the
 * platform's Business Discovery token, an agency's credential in any org, the
 * same person's connection on another creator record. So the revoke runs only
 * when none of those was granted by this user. When the grantor cannot be
 * established the grant is left in place, as for the agency disconnect
 * (revokeAgencyGrantIfUnshared); the row and its token still go.
 */
async function metaGrantHeldElsewhere(account: DisconnectableAccount, token: string): Promise<boolean> {
  try {
    const grantor =
      (await accountStatesFor([account.id])).get(account.id)?.grantorUserId ??
      (await fetchMetaGrantorId(account.platform === "FACEBOOK" ? "facebook" : "instagram", token));
    if (!grantor) return true;
    if ((await otherAgencyGrantors()).has(grantor)) return true;
    const others = (await accountIdsForGrantor(grantor)).filter((id) => id !== account.id);
    if (others.length > 0 && (await db.creatorSocialAccount.count({ where: { id: { in: others } } })) > 0) {
      return true;
    }
    return (await operatorTokenGrantedBy(grantor)) !== false;
  } catch {
    return true;
  }
}
