/**
 * Whether a campaign post is still up, as one answer (plan §13 A5).
 *
 * live | hidden | deleted | private | unverified, from the fields the sync path
 * already writes: Post.fetchState, Post.lastSyncedAt, and the `__lastFetch`
 * note applyPostMetrics leaves in platformMetrics on every read that came back
 * without counts (lib/metricDisplay). The list row, the grid card, the post
 * page, the shared report and every export resolve a post through this, so no
 * two of them can call the same post two different things.
 *
 * The rule that shapes it: a post is called gone only on evidence the platform
 * gave, and "deleted" only once two separate checks have said so (the 10-01
 * data plan). One "post-deleted" answer is a strong hint, not a verdict -- a
 * suspension, a region block or a reader bug answers the same way once -- so a
 * single strike is "unverified since {the last time we saw it live}", with the
 * strike named in the detail. The strike count is kept in the note itself
 * (`strikes`, `since`; see applyPostMetrics), so it costs no column.
 *
 * Every failure that is about us or the moment (a WAF wall, a dead lane, a
 * timeout, a lapsed token) leaves the post "unverified since" its last live
 * read: we could not look, which is not the same claim as "it is gone".
 *
 * "private" is in the vocabulary and nothing produces it yet. TikTok's "Only
 * me" is filed as hidden, which is what the platform says it is. Instagram's
 * Graph #110 ("no Business or Creator account by that name") covers personal,
 * private, renamed AND deleted accounts -- 79 of 80 such posts were gone on
 * 2026-09-30 -- so calling it private would be a guess; it resolves to
 * unverified with that reason instead.
 *
 * The counters are never touched by any of this. A hidden or deleted post keeps
 * the last numbers it was read with, and those are shown with their age.
 */
import { formatDateAbs } from "@/lib/format";
import { lastFetchNote, type LastFetchNote } from "@/lib/metricDisplay";
import type { AgeContext } from "@/lib/dataAge";

export type PostStatusKind = "live" | "hidden" | "deleted" | "private" | "unverified";

export type PostStatusInput = {
  fetchState?: string | null;
  platformMetrics?: unknown;
  /** Set only when counts came back: the last time the post was seen live. */
  lastSyncedAt?: string | Date | null;
  /** CreatorCore's own last refresh, carried by imported posts. */
  lastFreshAt?: string | Date | null;
};

export type PostStatus = {
  kind: PostStatusKind;
  /** What the chip says: "Live", "Hidden", "Deleted", "Unverified since 3 Sep 2026". */
  label: string;
  /** The whole sentence, for a tooltip and an export's status column. */
  detail: string;
  /** live: when it was last read. hidden/deleted: when that was first seen.
   *  unverified: the last time it was seen live, or null for never. */
  since: Date | null;
  /** When the platform was last asked about it, if we know. */
  checkedAt: Date | null;
  /** Where the status came from, for exports: "Platform read", "CreatorCore import". */
  source: string;
};

/** Two "post-deleted" answers on separate checks make a deletion. */
export const DELETED_AFTER_STRIKES = 2;

/** The reader's words for each way a read can come back empty, said about one post. */
const UNREAD_REASON: Record<string, string> = {
  "platform-challenged": "the platform showed a check page instead of the post",
  "reader-unavailable": "our reader could not run",
  "reader-timeout": "our read timed out",
  "backing-off": "reads are paused while the platform cools off",
  "platform-refused": "the platform refused the read",
  "no-counts-published": "the platform publishes no counts for it",
  "unrecognised-url": "the link is not one we recognise",
  "not-configured": "this platform needs an API key we do not have",
  "credentials-rejected": "the platform rejected our credentials",
  "not-a-professional-account":
    "Instagram shares nothing for this account; it may be personal, private, renamed or gone",
  "not-on-account":
    "Instagram did not list it on the creator's account; it may have been deleted or archived, or be on another account",
  "not-public":
    "Instagram won’t show it publicly; it was deleted, the account is private, or it is limited by region",
  "not-in-newest-media":
    "it was not among the creator's newest 500 Instagram posts, which is as far back as we can look; it may be older, or deleted or archived",
  "page-not-connected":
    "Facebook shares a Page post's numbers only with that Page's owner, and the Page it is on has not been connected here",
  "author-unknown":
    "the platform is not showing whose account it is on yet, so there is no account to read its numbers through; every refresh looks for the creator again and reads it once found",
  "counts-inconsistent":
    "the platform's numbers for it could not all be true (more likes than views, or views falling to zero), so its last consistent numbers are kept",
};

function toDate(at: string | Date | null | undefined): Date | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The strike count on a note; a note written before strikes were kept is one. */
export function noteStrikes(note: LastFetchNote | null | undefined): number {
  if (!note) return 0;
  return typeof note.strikes === "number" && note.strikes > 0 ? Math.floor(note.strikes) : 1;
}

function unverified(seenLive: Date | null, checkedAt: Date | null, why: string, source = "Platform read"): PostStatus {
  const label = seenLive ? `Unverified since ${formatDateAbs(seenLive)}` : "Unverified";
  const lead = seenLive ? `Not confirmed live since ${formatDateAbs(seenLive)}` : "Never confirmed live";
  return { kind: "unverified", label, detail: `${lead}: ${why}.`, since: seenLive, checkedAt, source };
}

export function postStatus(post: PostStatusInput | null | undefined): PostStatus {
  const note = lastFetchNote(post?.platformMetrics);
  const seenLive = toDate(post?.lastSyncedAt);
  const checkedAt = toDate(note?.at) ?? seenLive;
  const firstSeen = toDate(note?.since) ?? toDate(note?.at);

  if (note?.reason === "post-hidden") {
    return {
      kind: "hidden",
      label: "Hidden",
      detail: `Hidden: the creator set it to "Only me"${firstSeen ? ` (seen ${formatDateAbs(firstSeen)})` : ""}. It can come back; its last numbers are kept.`,
      since: firstSeen,
      checkedAt,
      source: "Platform read",
    };
  }

  if (note?.reason === "post-deleted") {
    const strikes = noteStrikes(note);
    if (strikes >= DELETED_AFTER_STRIKES) {
      return {
        kind: "deleted",
        label: "Deleted",
        detail: `Deleted: the platform said it is gone on ${strikes} separate checks${firstSeen ? `, first on ${formatDateAbs(firstSeen)}` : ""}. Its last numbers are kept.`,
        since: firstSeen,
        checkedAt,
        source: "Platform read",
      };
    }
    return unverified(
      seenLive,
      checkedAt,
      `the platform reported it gone${firstSeen ? ` on ${formatDateAbs(firstSeen)}` : ""}, and it is called deleted only once a second check agrees`,
    );
  }

  if (post?.fetchState === "UNAVAILABLE") {
    /* UNAVAILABLE with no deletion note: either an imported CreatorCore status
       or a deletion answer that a later, failed read has since overwritten.
       Neither is a second check of ours. */
    return unverified(
      seenLive,
      checkedAt,
      note ? "it was reported gone earlier, and the latest check could not reach it" : "an earlier source marked it unavailable, and no check of ours has confirmed it",
      note ? "Platform read" : "CreatorCore import",
    );
  }

  if (note) {
    return unverified(seenLive, checkedAt, UNREAD_REASON[note.reason] ?? "the last read returned nothing");
  }

  if (seenLive) {
    return {
      kind: "live",
      label: "Live",
      detail: `Live: read ${formatDateAbs(seenLive)}.`,
      since: seenLive,
      checkedAt: seenLive,
      source: "Platform read",
    };
  }

  const imported = toDate(post?.lastFreshAt);
  if (post?.fetchState === "LIVE" && imported) {
    return {
      kind: "live",
      label: "Live",
      detail: `Live as of ${formatDateAbs(imported)}, per the CreatorCore import; not read by us yet.`,
      since: imported,
      checkedAt: imported,
      source: "CreatorCore import",
    };
  }

  return unverified(null, null, "it has not been read from the platform yet");
}

/** Whether a status should be pointed out on a screen. "live" is the quiet default. */
export function isNoteworthyStatus(status: PostStatus): boolean {
  return status.kind !== "live";
}

/** The spreadsheet cell: "Live", "Hidden", "Deleted", "Unverified since 3 Sep 2026". */
export function postStatusCell(post: PostStatusInput | null | undefined): string {
  return postStatus(post).label;
}

/**
 * The time a post's counters were measured, and by whom: our own read
 * (lastSyncedAt) or, for an imported post we have not read, CreatorCore's last
 * refresh (lastFreshAt). Null when neither exists -- no age is invented.
 */
export function postMeasuredAt(post: PostStatusInput | null | undefined): { at: Date | null; source: string } {
  const synced = toDate(post?.lastSyncedAt);
  if (synced) return { at: synced, source: "Platform read" };
  const imported = toDate(post?.lastFreshAt);
  if (imported) return { at: imported, source: "CreatorCore import" };
  return { at: null, source: "Not read" };
}

/**
 * The lib/dataAge context for a post's counters: how old the post is, and
 * whether anything still reads it. A post whose tracker is off or expired, or
 * which the platform says is hidden or gone, is not read again on schedule, so
 * its numbers are final rather than late and never earn a Stale chip.
 */
export function postAgeContext(
  post: { postedAt?: string | Date | null; trackingEnabled?: boolean | null; trackingExpiresAt?: string | Date | null },
  status: PostStatus,
  now: Date = new Date(),
): AgeContext {
  const expires = toDate(post.trackingExpiresAt);
  const tracking = post.trackingEnabled === true && (!expires || expires > now);
  const gone = status.kind === "hidden" || status.kind === "deleted" || status.kind === "private";
  return { postedAt: post.postedAt ?? null, tracked: tracking && !gone };
}

/**
 * Many posts' statuses in one cell, for a per-creator export row: "All live",
 * or "3 live, 1 hidden, 2 unverified". "No posts" when there are none.
 */
export function postStatusSummary(statuses: readonly Pick<PostStatus, "kind">[]): string {
  if (statuses.length === 0) return "No posts";
  const order: PostStatusKind[] = ["live", "hidden", "deleted", "private", "unverified"];
  const counts = new Map<PostStatusKind, number>();
  for (const s of statuses) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  if (counts.size === 1 && counts.has("live")) return "All live";
  return order
    .filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${k}`)
    .join(", ");
}
