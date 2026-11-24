import type { AdPermission } from "./instagramPartnership";

/**
 * Sample answers in Meta's response shapes for META_DEMO_MOCK=1 (never
 * production). Any post id is treated as the creator's own, so the Partnership
 * Ads screens can be run against whatever posts the local
 * database holds. State lives for the life of the dev server. Names and text
 * are made up.
 */

const boost = new Map<string, Set<string>>();
const adPerms = new Map<string, AdPermission>();

export const igDemo = {
  ownsMedia: (mediaId: string) => /^[0-9A-Za-z_]{3,64}$/.test(mediaId),

  boostPartners: (mediaId: string) => [...(boost.get(mediaId) ?? [])],
  setBoost(mediaId: string, sponsorId: string, allow: boolean) {
    const set = boost.get(mediaId) ?? new Set<string>();
    if (allow) set.add(sponsorId);
    else set.delete(sponsorId);
    boost.set(mediaId, set);
    return true;
  },

  adPermissions: (username: string) => {
    const p = adPerms.get(username.toLowerCase());
    return p ? [p] : [];
  },
  requestAdPermission(username: string) {
    const key = username.toLowerCase();
    adPerms.set(key, { id: `perm_${key}`, creatorUsername: username, creatorId: `ig_${key}`, status: "PENDING" });
    return true;
  },
  revokeAdPermission(creatorIgId: string) {
    for (const p of adPerms.values()) if (p.creatorId === creatorIgId) p.status = "REVOKED";
    return true;
  },
};
