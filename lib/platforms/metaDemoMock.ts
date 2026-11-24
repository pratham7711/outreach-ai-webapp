import type { AdPermission } from "./instagramPartnership";

/**
 * Sample answers in Meta's response shapes for META_DEMO_MOCK=1 (never
 * production). Any post id is treated as the creator's own, so the comment
 * and Partnership Ads screens can be run against whatever posts the local
 * database holds. State lives for the life of the dev server. Names and text
 * are made up.
 */

type RawComment = { id: string; text: string; username: string; like_count: number; timestamp: string; hidden: boolean; replies?: { data: RawComment[] } };

const HOUR = 3_600_000;
const comments = new Map<string, RawComment[]>();
const commentMedia = new Map<string, string>();
const boost = new Map<string, Set<string>>();
const adPerms = new Map<string, AdPermission>();
const tagApproved = new Set<string>();

function seed(mediaId: string): RawComment[] {
  const existing = comments.get(mediaId);
  if (existing) return existing;
  const at = (h: number) => new Date(Date.now() - h * HOUR).toISOString();
  const mk = (n: number, username: string, text: string, likes: number, h: number, replies: RawComment[] = []): RawComment => {
    const id = `${mediaId}_c${n}`;
    commentMedia.set(id, mediaId);
    for (const r of replies) commentMedia.set(r.id, mediaId);
    return { id, text, username, like_count: likes, timestamp: at(h), hidden: false, replies: { data: replies } };
  };
  const list = [
    mk(1, "melody.maker", "Need the full version of this", 48, 30, [
      { id: `${mediaId}_c1_r1`, text: "Same!!", username: "jules_sings", like_count: 3, timestamp: at(28), hidden: false },
    ]),
    mk(2, "tourbus.diaries", "Where was this filmed?", 12, 20),
    mk(3, "cheap.followers.now", "Get 10k followers today, link in bio", 0, 6),
    mk(4, "nightowl.audio", "The mix on this is so clean", 21, 3),
  ];
  comments.set(mediaId, list);
  return list;
}

function find(commentId: string): { list: RawComment[]; index: number; parent: RawComment | null } | null {
  const mediaId = commentMedia.get(commentId);
  if (!mediaId) return null;
  const list = seed(mediaId);
  const top = list.findIndex((c) => c.id === commentId);
  if (top >= 0) return { list, index: top, parent: null };
  for (const c of list) {
    const r = c.replies?.data ?? [];
    const i = r.findIndex((x) => x.id === commentId);
    if (i >= 0) return { list: r, index: i, parent: c };
  }
  return null;
}

export const igDemo = {
  ownsMedia: (mediaId: string) => /^[0-9A-Za-z_]{3,64}$/.test(mediaId),
  mediaOfComment: (commentId: string) => commentMedia.get(commentId) ?? null,
  comments: (mediaId: string) => seed(mediaId) as unknown as Record<string, unknown>[],

  reply(commentId: string, message: string) {
    const hit = find(commentId);
    if (!hit) return false;
    const top = hit.parent ?? hit.list[hit.index];
    const replies = (top.replies ??= { data: [] }).data;
    const id = `${top.id}_r${replies.length + 1}_${Date.now()}`;
    commentMedia.set(id, commentMedia.get(top.id)!);
    replies.push({ id, text: message, username: "you", like_count: 0, timestamp: new Date().toISOString(), hidden: false });
    return true;
  },
  hide(commentId: string, hide: boolean) {
    const hit = find(commentId);
    if (!hit) return false;
    hit.list[hit.index].hidden = hide;
    return true;
  },
  remove(commentId: string) {
    const hit = find(commentId);
    if (!hit) return false;
    hit.list.splice(hit.index, 1);
    commentMedia.delete(commentId);
    return true;
  },

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
  approvedToTag: (creatorIgId: string) => tagApproved.has(creatorIgId),
  setApprovedToTag(creatorIgId: string, approved: boolean) {
    if (approved) tagApproved.add(creatorIgId);
    else tagApproved.delete(creatorIgId);
    return true;
  },
};
