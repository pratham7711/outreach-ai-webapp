import { graphGet } from "./instagram";
import { graphWrite } from "./instagramComments";
import { metaDemoMocked } from "@/lib/oauth/metaReviewScopes";
import { igDemo } from "./metaDemoMock";

/**
 * Partnership Ads (Meta's Marketing API "Partnership Ads API").
 *
 * Creator side, instagram_branded_content_creator: on one of their own
 * branded posts, the creator turns "Allow brand partner to boost" on or off
 * for a brand (POST /{ig-media-id}/branded_content_partner_promote) and sees
 * which brands may (GET on the same edge).
 *
 * Brand side, with the agency's own Instagram account:
 *  - instagram_branded_content_ads_brand + business_management: ask a creator
 *    for account-level partnership ad permission, see where each request
 *    stands, and revoke it (/{ig-user-id}/branded_content_ad_permissions).
 *  - instagram_branded_content_brand: the brand's list of creators approved to
 *    tag it as a paid partner (/{ig-user-id}/branded_content_tag_approval).
 *
 * Every change is one click by the person whose permission it is.
 */

/* ---------- creator side ---------- */

/** Brand accounts the creator has allowed to boost this post. */
export async function approvedBoostPartners(token: string, mediaId: string): Promise<string[] | null> {
  if (metaDemoMocked()) return igDemo.boostPartners(mediaId);
  const data = await graphGet(`${mediaId}/branded_content_partner_promote`, { access_token: token });
  if (!data) return null;
  const approved = data.approved ?? data.data;
  if (Array.isArray(approved)) return approved.map((a) => (typeof a === "object" && a ? String(a.id ?? "") : String(a))).filter(Boolean);
  if (typeof approved === "string") return approved.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export async function setBoostPermission(token: string, mediaId: string, sponsorId: string, allow: boolean): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.setBoost(mediaId, sponsorId, allow);
  return graphWrite("POST", `${mediaId}/branded_content_partner_promote`, {
    sponsor_id: sponsorId,
    permission: allow ? "true" : "false",
    access_token: token,
  });
}

/* ---------- brand side ---------- */

export type AdPermission = {
  id: string;
  creatorUsername: string;
  creatorId: string | null;
  status: "APPROVED" | "PENDING" | "REVOKED" | "REJECTED" | "EXPIRED" | "UNKNOWN";
};

const STATUSES = new Set(["APPROVED", "PENDING", "REVOKED", "REJECTED", "EXPIRED"]);

export async function listAdPermissions(token: string, brandIgUserId: string, creatorUsername: string): Promise<AdPermission[] | null> {
  if (metaDemoMocked()) return igDemo.adPermissions(creatorUsername);
  const data = await graphGet(`${brandIgUserId}/branded_content_ad_permissions`, {
    creator_username: creatorUsername,
    access_token: token,
  });
  if (!data) return null;
  return ((data.data as Record<string, unknown>[]) ?? []).map((p) => {
    const status = String(p.permission_status ?? "").toUpperCase();
    return {
      id: String(p.id ?? ""),
      creatorUsername: String(p.creator_username ?? creatorUsername),
      creatorId: p.creator_id ? String(p.creator_id) : null,
      status: (STATUSES.has(status) ? status : "UNKNOWN") as AdPermission["status"],
    };
  });
}

export async function requestAdPermission(token: string, brandIgUserId: string, creatorUsername: string): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.requestAdPermission(creatorUsername);
  return graphWrite("POST", `${brandIgUserId}/branded_content_ad_permissions`, {
    creator_instagram_username: creatorUsername,
    access_token: token,
  });
}

export async function revokeAdPermission(token: string, brandIgUserId: string, creatorIgId: string): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.revokeAdPermission(creatorIgId);
  return graphWrite("POST", `${brandIgUserId}/branded_content_ad_permissions`, {
    creator_instagram_account: creatorIgId,
    revoke: "true",
    access_token: token,
  });
}

export async function isApprovedToTag(token: string, brandIgUserId: string, creatorIgId: string): Promise<boolean | null> {
  if (metaDemoMocked()) return igDemo.approvedToTag(creatorIgId);
  const data = await graphGet(`${brandIgUserId}/branded_content_tag_approval`, { user_ids: creatorIgId, access_token: token });
  if (!data) return null;
  return ((data.data as Array<{ id?: string }>) ?? []).some((r) => String(r.id) === creatorIgId);
}

export async function setApprovedToTag(token: string, brandIgUserId: string, creatorIgId: string, approved: boolean): Promise<boolean> {
  if (metaDemoMocked()) return igDemo.setApprovedToTag(creatorIgId, approved);
  return graphWrite(approved ? "POST" : "DELETE", `${brandIgUserId}/branded_content_tag_approval`, {
    user_ids: creatorIgId,
    access_token: token,
  });
}
