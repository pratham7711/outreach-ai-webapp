/**
 * What to tell someone who just pressed Refresh Data.
 *
 * Lives here rather than inside PostsTab because it is the whole user-facing
 * result of the operation and nothing about it is React. A refresh either
 * changed numbers or it did not, and the difference is the point of the button:
 * "measured" is the only count that means new data landed, and the rest exist to
 * explain why nothing moved.
 */
import type { RefreshFailReason } from "@/lib/sync/refreshCampaign";


export type RefreshResult = {
  total?: number;
  measured?: number;
  noMetrics?: number;
  unfetchable?: number;
  failed?: number;
  remaining?: number;
  /**
   * How many posts came back each way, keyed by reason.
   *
   * The count on its own was not usable. "87 returned no metrics" reads as a
   * fault in the campaign or in us, when in practice almost all of it is TikTok
   * serving a challenge page to a datacenter address -- which is a different
   * problem with a different answer, and it was invisible without reading the
   * platform logs by hand.
   */
  reasons?: Record<string, number>;
  /**
   * The same run snapshots the campaign's tracked sound, and this summary used
   * to drop that half on the floor: a run where the audio was unreachable still
   * read as a clean success. On a campaign built around a sound, that is the
   * half that matters.
   */
  sound?: SoundRefreshResult | null;
};

export type SoundRefreshResult = {
  snapshots?: number;
  failed?: number;
  skipped?: number;
};

/**
 * Null when the campaign tracks no sound, so those campaigns read exactly as
 * they did before. Null too for `skipped`, which means the sound was checked too
 * recently to re-fetch -- not news, and not a failure.
 */
export function describeAudioRefresh(sound?: SoundRefreshResult | null): string | null {
  if (!sound) return null;
  if (sound.failed) return "The campaign audio could not be reached.";
  if (sound.snapshots) return "Campaign audio updated.";
  return null;
}

/**
 * What a tracker sweep actually did, in one sentence.
 *
 * The page said "Updated 1 sound" and stopped, so a sweep answering
 * {snapshots: 1, failed: 40} — a near-total outage — was reported as a plain
 * success and the 40 sounds that got nothing were visible only by opening each
 * row. A partial result is a warning, and it says how partial.
 */
export function describeTrackerSweep(result: {
  snapshots: number;
  failed: number;
  skipped?: number;
}): { tone: "success" | "warning" | "error"; text: string } {
  const { snapshots, failed } = result;
  const sounds = (n: number) => `${n} sound${n === 1 ? "" : "s"}`;

  if (snapshots > 0 && failed > 0) {
    return {
      tone: "warning",
      text: `Updated ${sounds(snapshots)} — TikTok returned no count for ${failed} other${failed === 1 ? "" : "s"}`,
    };
  }
  if (snapshots > 0) return { tone: "success", text: `Updated ${sounds(snapshots)}` };
  if (failed > 0) return { tone: "error", text: "TikTok did not return counts for any tracked sound" };
  /* Nothing read and nothing failed: the cadence gate declined every sound
     because its last reading is recent enough that another would record the
     same number. Saying "updated" there would be a lie. */
  return { tone: "success", text: "Nothing to refresh" };
}

/**
 * Plain English for each reason. Anything unrecognised is deliberately left out
 * of the sentence rather than printed raw -- a slug in the UI is worse than a
 * slightly shorter summary.
 */
/* These now reach the toolbar sentence, where "1 no longer exist" read badly. */
const agree = (n: number, one: string, many: string) => (n === 1 ? one : many);

const REASON_LABEL: Record<RefreshFailReason, (n: number) => string> = {
  "platform-challenged": (n) => `${n} blocked by the platform`,
  /* Says "we", not "the platform". This is the one failure on the list that is
     ours, and the reader who sees it should know the post is fine and the retry
     is on us -- not go asking TikTok why it blocked them. */
  "reader-unavailable": (n) => `${n} we could not read, retrying`,
  /* Also ours, and worded so nobody goes looking at Instagram for the cause.
     "timed out" without "on our side" reads as the platform being slow, which
     is the same misdirection this reason was added to end. */
  "reader-timeout": (n) => `${n} timed out on our side, retrying`,
  "backing-off": (n) => `${n} skipped while backing off`,
  "post-deleted": (n) => `${n} ${agree(n, "no longer exists", "no longer exist")}`,
  "post-hidden": (n) => `${n} ${agree(n, "was", "were")} hidden by their creator`,
  "platform-refused": (n) => `${n} refused by the platform`,
  "no-counts-published": (n) => `${n} ${agree(n, "publishes", "publish")} no counts`,
  unknown: (n) => `${n} could not be read`,
  "unrecognised-url": (n) => `${n} ${agree(n, "has", "have")} an unrecognised link`,
  "not-configured": (n) => `${n} ${agree(n, "needs", "need")} an API key`,
  /* The only reason on this list with a remedy belonging to a person, so it
     says whose: a creator reconnects, or an operator replaces the business
     token. "refused by the platform" -- which is where this used to land --
     reads as nothing anyone can do. */
  "credentials-rejected": (n) => `${n} ${agree(n, "needs", "need")} Instagram reconnected`,
  "not-a-professional-account": (n) => `${n} ${agree(n, "is on an Instagram account", "are on Instagram accounts")} that share${agree(n, "s", "")} no numbers`,
  "page-not-connected": (n) => `${n} ${agree(n, "is on a Facebook Page that is", "are on Facebook Pages that are")} not connected`,
  "author-unknown": (n) => `${n} ${agree(n, "has", "have")} no creator yet; we keep looking automatically`,
  "not-on-account": (n) => `${n} ${agree(n, "was", "were")} not found on their creator's Instagram`,
  "not-in-newest-media": (n) => `${n} ${agree(n, "was", "were")} not among their creator's newest 500 Instagram posts`,
  "not-public": (n) => `${n} ${agree(n, "is", "are")} not public on Instagram: age-limited by the creator, private or deleted`,
  "counts-inconsistent": (n) => `${n} came back with numbers that could not be right, kept their last good numbers`,
  error: (n) => `${n} errored`,
};

/**
 * The reasons-tally key for a post that measured, but without views. Defined
 * here rather than beside the tally because this module ships to the browser
 * and lib/sync/refreshCampaign does not. See readLackedViews there.
 */
export const VIEWS_UNAVAILABLE = "views-unavailable";

/* Keys in the reasons tally that are not fetch reasons: a post counted here
   was measured, and the key says what that reading still left out. */
const PARTIAL_LABEL: Record<string, (n: number) => string> = {
  [VIEWS_UNAVAILABLE]: (n) => `${n} updated without new views`,
};

/* Widened deliberately: the map is exhaustive over the union so that adding a
   reason without wording fails the build, but `reasons` is parsed from a JSON
   payload and can carry a slug from a newer deployment than this bundle. */
function labelFor(key: string): ((n: number) => string) | undefined {
  return (REASON_LABEL as Record<string, (n: number) => string>)[key] ?? PARTIAL_LABEL[key];
}

/**
 * The whole breakdown, partials included, for whoever is debugging a run
 * record. summariseRefresh shows the failure half of it (failureReasons below).
 */
export function describeReasons(reasons?: Record<string, number>): string | null {
  if (!reasons) return null;
  const parts = Object.entries(reasons)
    // Biggest first: the dominant reason is the one worth acting on.
    .sort((a, b) => b[1] - a[1])
    .filter(([key, n]) => n > 0 && labelFor(key))
    .map(([key, n]) => labelFor(key)!(n));
  if (!parts.length) return null;
  return parts.join(", ");
}

/** The failure reasons only, biggest first, in the same words as describeReasons. */
function failureReasons(reasons?: Record<string, number>): string | null {
  if (!reasons) return null;
  const parts = Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .filter(([key, n]) => n > 0 && (REASON_LABEL as Record<string, (n: number) => string>)[key])
    .map(([key, n]) => (REASON_LABEL as Record<string, (n: number) => string>)[key](n));
  return parts.length ? parts.join(", ") : null;
}

/**
 * What the user is told after a refresh: how many posts updated out of how
 * many, and why the rest did not.
 *
 * History, because this has moved three times. On 2026-09-03 the owner cut it
 * to a bare "Posts updated." (no ratio, no reasons), on the grounds that the
 * breakdown read as the product apologising. The 2026-10-13 walkthrough showed
 * the cost: a run that updated 1 post of 3 said "Post updated." and gave no
 * reason for the other two, which is a success claim the run did not earn.
 * Pratham's brief for that round asks for the accurate version, e.g.
 * "1 of 3 updated · 2 couldn't be read: …", so the ratio and the failure
 * reasons are back, in the plain wording REASON_LABEL already has.
 *
 *   - Every post landed: "All 3 posts updated." (one post: "Post updated.")
 *   - Some did not: "1 of 3 updated · 2 couldn't be read: 1 blocked by the
 *     platform, 1 no longer exist."
 *   - The time budget ran out first: "· 5 not reached this time; press
 *     Refresh Data again".
 *   - A reading that came back without views is a partial, said after.
 * The audio sentence follows, as before. Every reason is still recorded on
 * CampaignRefreshRun.reasons and per post, so nothing here is the only copy.
 */
export function summariseRefresh(r: RefreshResult): string {
  const total = r.total ?? 0;
  const audio = describeAudioRefresh(r.sound);

  if (total === 0) {
    return audio ? `No posts to refresh yet. ${audio}` : "No posts to refresh yet.";
  }

  const measured = Math.min(Math.max(r.measured ?? 0, 0), total);
  const remaining = Math.min(Math.max(r.remaining ?? 0, 0), total - measured);
  const unread = total - measured - remaining;

  const parts: string[] = [];
  if (measured === total) {
    parts.push(total === 1 ? "Post updated" : `All ${total} posts updated`);
  } else {
    parts.push(`${measured} of ${total} updated`);
    if (unread > 0) {
      const why = failureReasons(r.reasons);
      parts.push(`${unread} couldn't be read${why ? `: ${why}` : ""}`);
    }
    if (remaining > 0) parts.push(`${remaining} not reached this time; press Refresh Data again`);
  }
  /* Measured, so counted as updated above, but the reading had no views in it
     (see VIEWS_UNAVAILABLE). Said after the ratio so the ratio stays true. */
  const noViews = Math.min(r.reasons?.[VIEWS_UNAVAILABLE] ?? 0, measured);
  if (noViews > 0) parts.push(`${noViews} without new views`);

  return [`${parts.join(" · ")}.`, audio].filter(Boolean).join(" ");
}
