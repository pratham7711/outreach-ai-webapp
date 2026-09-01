/**
 * What to tell someone who just pressed Refresh Data.
 *
 * Lives here rather than inside PostsTab because it is the whole user-facing
 * result of the operation and nothing about it is React. A refresh either
 * changed numbers or it did not, and the difference is the point of the button:
 * "measured" is the only count that means new data landed, and the rest exist to
 * explain why nothing moved.
 */

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
const REASON_LABEL: Record<string, (n: number) => string> = {
  "platform-challenged": (n) => `${n} blocked by the platform`,
  "backing-off": (n) => `${n} skipped while backing off`,
  "post-deleted": (n) => `${n} no longer exist`,
  "platform-refused": (n) => `${n} refused by the platform`,
  "no-counts-published": (n) => `${n} publish no counts`,
  "unrecognised-url": (n) => `${n} have an unrecognised link`,
  "not-configured": (n) => `${n} need an API key`,
  error: (n) => `${n} errored`,
};

export function describeReasons(reasons?: Record<string, number>): string | null {
  if (!reasons) return null;
  const parts = Object.entries(reasons)
    // Biggest first: the dominant reason is the one worth acting on.
    .sort((a, b) => b[1] - a[1])
    .filter(([key, n]) => n > 0 && REASON_LABEL[key])
    .map(([key, n]) => REASON_LABEL[key](n));
  if (!parts.length) return null;
  return parts.join(", ");
}

export function summariseRefresh(r: RefreshResult): string {
  const total = r.total ?? 0;
  const audio = describeAudioRefresh(r.sound);

  if (total === 0) {
    return audio ? `No posts to refresh yet. ${audio}` : "No posts to refresh yet.";
  }

  const parts = [`${r.measured ?? 0} of ${total} post${total === 1 ? "" : "s"} updated`];

  /* Prefer the breakdown over the bare total. Falls back to the old wording
     when a run predates reason tracking, or when every reason is unknown. */
  const why = describeReasons(r.reasons);
  const empty = (r.noMetrics ?? 0) + (r.unfetchable ?? 0);
  if (why) parts.push(why);
  else if (empty > 0) parts.push(`${empty} returned no metrics`);

  if (r.failed && !r.reasons?.error) parts.push(`${r.failed} failed`);
  if (r.remaining) parts.push(`${r.remaining} left for the next run`);

  return `${parts.join(", ")}.${audio ? ` ${audio}` : ""}`;
}
