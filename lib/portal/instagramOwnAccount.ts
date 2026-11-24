import { db } from "@/lib/db";
import type { CreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { fetchInstagramAccount } from "@/lib/platforms/instagramAccount";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { metaDemoMocked } from "@/lib/oauth/metaReviewScopes";

/**
 * One of the signed-in creator's OWN Instagram connections (Facebook Login),
 * with a usable token and its Instagram user id. Shared by the creator's
 * comment and Partnership Ads screens; the grant gate finds the connection,
 * exactly as My stats does.
 */
export type OwnInstagram =
  | { ok: true; token: string; igUserId: string; handle: string; orgIds: string[] }
  | { ok: false; status: number; error: string; reason: string };

export async function ownInstagram(session: CreatorSession, accountId: string): Promise<OwnInstagram> {
  const creators = await findLinkedCreatorsForHandle(session);
  for (const creator of creators) {
    const read = await connectionForRead(creator.orgId, creator.id, "INSTAGRAM", { where: { id: accountId } });
    if (!read.ok) continue;
    if (isInstagramLoginRow(read.connection.origin))
      return { ok: false, status: 409, error: "unsupported_login", reason: "Comments and partnership ads work with Instagram connected through Meta's login on My accounts." };
    const token = (await ensureFreshInstagramToken(read.connection, creator.orgId)) ?? (metaDemoMocked() ? "demo-token" : undefined);
    if (!token) return { ok: false, status: 409, error: "reauthorize", reason: "Access to this Instagram account has lapsed. Reconnect it from My accounts." };
    const igUserId =
      read.connection.platformUserId ?? (metaDemoMocked() ? `ig_${read.connection.handle}` : (await fetchInstagramAccount(token))?.igUserId ?? null);
    if (!igUserId) return { ok: false, status: 409, error: "no_business_account", reason: "No Instagram professional account came back for this connection." };
    return { ok: true, token, igUserId, handle: read.connection.handle, orgIds: [...new Set(creators.map((c) => c.orgId))] };
  }
  return { ok: false, status: 404, error: "not_your_account", reason: "That Instagram account is not connected to your portal." };
}

export type BrandPartner = { sponsorId: string; username: string; orgName: string };

/** The brand Instagram accounts of the organisations this creator works
    with -- the partners a creator can let boost a post. */
export async function brandPartnersFor(orgIds: string[]): Promise<BrandPartner[]> {
  const orgs = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  const out: BrandPartner[] = [];
  for (const org of orgs) {
    const cred = await getAgencyDiscoveryCredential(org.id);
    if (cred) out.push({ sponsorId: cred.igUserId, username: cred.username, orgName: org.name });
    else if (metaDemoMocked()) out.push({ sponsorId: `brand_${org.id.slice(-6)}`, username: `${org.name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, orgName: org.name });
  }
  return out;
}
