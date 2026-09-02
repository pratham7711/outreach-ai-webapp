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
 * Plain English for each reason. Anything unrecognised is deliberately left out
 * of the sentence rather than printed raw -- a slug in the UI is worse than a
 * slightly shorter summary.
 */
const REASON_LABEL: Record<RefreshFailReason, (n: number) => string> = {
  "platform-challenged": (n) => `${n} blocked by the platform`,
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
 * What the user is told after a refresh: how much landed, and nothing else.
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
 */
export function summariseRefresh(r: RefreshResult): string {
  const total = r.total ?? 0;
  const audio = describeAudioRefresh(r.sound);

  if (total === 0) {
    return audio ? `No posts to refresh yet. ${audio}` : "No posts to refresh yet.";
  }

  /* The count stays. "Updated." on a run that moved 27 of 58 would be the
     opposite mistake -- hiding that most of the campaign holds numbers from an
     hour ago, which is the one part of this the reader can act on by pressing
     it again later. */
  const measured = r.measured ?? 0;
  const sentence = `${measured} of ${total} post${total === 1 ? "" : "s"} updated.`;

  /* And, when some did not land, why -- on this screen only.
     
     Removing this was right for the shared client report and wrong here. This
     is the operator's own campaign screen, and "41 of 62 updated" with the
     cause withheld is the one thing they cannot act on: the reason was sitting
     in the response the whole time and the answer to "why?" was a log dig. The
     public report at (public)/share renders its own summary and never reaches
     this branch, so the brand still never sees it. */
  const why = measured < total ? describeReasons(r.reasons) : null;
  const parts = [sentence, why ? `${why}.` : null, audio].filter(Boolean);
  return parts.join(" ");
}
