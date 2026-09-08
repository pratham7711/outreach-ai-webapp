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
  "post-deleted": (n) => `${n} no longer exist`,
  "platform-refused": (n) => `${n} refused by the platform`,
  "no-counts-published": (n) => `${n} publish no counts`,
  unknown: (n) => `${n} could not be read`,
  "unrecognised-url": (n) => `${n} have an unrecognised link`,
  "not-configured": (n) => `${n} need an API key`,
  /* The only reason on this list with a remedy belonging to a person, so it
     says whose: a creator reconnects, or an operator replaces the business
     token. "refused by the platform" -- which is where this used to land --
     reads as nothing anyone can do. */
  "credentials-rejected": (n) => `${n} need Instagram reconnected`,
  error: (n) => `${n} errored`,
};

/* Widened deliberately: the map is exhaustive over the union so that adding a
   reason without wording fails the build, but `reasons` is parsed from a JSON
   payload and can carry a slug from a newer deployment than this bundle. */
function labelFor(key: string): ((n: number) => string) | undefined {
  return (REASON_LABEL as Record<string, (n: number) => string>)[key];
}

/**
 * No longer part of the sentence the user reads -- see summariseRefresh. Kept
 * because the breakdown is still the right thing to put in front of whoever is
 * debugging a bad run, and it is the only place these slugs have wording.
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

/**
 * What the user is told after a refresh: that it happened, and nothing else.
 *
 * The breakdown this used to append -- "15 blocked by the platform, 13 publish
 * no counts, 3 no longer exist" -- was accurate and was the wrong audience. It
 * described OUR delivery problem in the platform's terms, in the middle of
 * somebody's campaign screen, and there is no action for the reader in any of
 * it: they cannot un-wall a TikTok WAF or make a deleted post exist. It read as
 * the product blaming itself in public.
 *
 * The reasons have not stopped being collected. Every one is still counted onto
 * CampaignRefreshRun.reasons and still logged per post, so the diagnostic
 * question is answered from the run record instead of from the toolbar --
 * describeReasons() below stays exported for exactly that. This is a change of
 * audience, not a loss of data.
 *
 * Reduced twice on the same day (2026-09-03): first to drop the breakdown and
 * keep "41 of 62", then to drop the ratio too. The end state is a single
 * sentence that a refresh happened, because everything more specific was either
 * an unactionable apology (the reasons) or an invitation to ask for one (the
 * ratio). Per-post freshness still lives on each post's own row, where the
 * reader can do something about it.
 */
export function summariseRefresh(r: RefreshResult): string {
  const total = r.total ?? 0;
  const audio = describeAudioRefresh(r.sound);

  if (total === 0) {
    return audio ? `No posts to refresh yet. ${audio}` : "No posts to refresh yet.";
  }

  /* No count either, owner's call 2026-09-03. The earlier version said
     "41 of 62 posts updated." on the grounds that "n of m" is the one part a
     reader can act on -- press it again later for the rest. Overruled: the
     ratio invited exactly the question the breakdown used to answer badly, and
     the freshness of any single post is already on that post's own row.

     The one thing this must not become is a false claim. A run that measured
     nothing has not updated anything, and "Posts updated." there would be a
     lie told by the toolbar -- so that case says so, still without naming a
     cause. Everything about why remains in the run record and the log. */
  const measured = r.measured ?? 0;
  const sentence =
    measured === 0
      ? "No new data yet."
      : `Post${measured === 1 ? "" : "s"} updated.`;

  /* Do not re-append the breakdown here. Nothing is lost by its absence, and
     that is the condition of having removed it -- every reason is still
     recorded in three places, none of which is this string:
       - CampaignRefreshRun.reasons, the whole tally, one row per run
       - Post.platformMetrics.__lastFetch, per post, with a timestamp
       - the "campaign refresh finished" log line
     describeReasons() above is where the wording for those lives. */
  const parts = [sentence, audio].filter(Boolean);
  return parts.join(" ");
}
