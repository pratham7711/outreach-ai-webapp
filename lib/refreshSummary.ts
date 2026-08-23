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

export function summariseRefresh(r: RefreshResult): string {
  const total = r.total ?? 0;
  const audio = describeAudioRefresh(r.sound);

  if (total === 0) {
    return audio ? `No posts to refresh yet. ${audio}` : "No posts to refresh yet.";
  }

  const parts = [`${r.measured ?? 0} of ${total} post${total === 1 ? "" : "s"} updated`];
  const empty = (r.noMetrics ?? 0) + (r.unfetchable ?? 0);
  if (empty > 0) parts.push(`${empty} returned no metrics`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.remaining) parts.push(`${r.remaining} left for the next run`);

  return `${parts.join(", ")}.${audio ? ` ${audio}` : ""}`;
}
