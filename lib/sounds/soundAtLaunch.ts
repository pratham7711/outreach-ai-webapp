/**
 * A sound's video count when the campaign launched, beside its count now.
 *
 * "At launch" is the newest reading taken at or before the launch, and only if
 * it is at most AT_LAUNCH_WINDOW_MS old by then: a reading from three weeks
 * earlier says little about the count on launch day. Without one, the first
 * reading after the launch is offered instead, labelled as such, so the card
 * never passes a later count off as the launch figure.
 */

export const AT_LAUNCH_WINDOW_MS = 48 * 60 * 60 * 1000;

type Point = { t: number; uses: number; rounded: boolean };

export type SoundAtLaunch =
  | { kind: "atLaunch"; atLaunch: Point; now: Point; added: number | null }
  | { kind: "firstAfter"; firstAfter: Point; now: Point }
  | { kind: "none" };

export function soundAtLaunch(series: readonly Point[], launchMs: number | null | undefined): SoundAtLaunch | null {
  if (launchMs == null || !Number.isFinite(launchMs) || series.length === 0) return null;
  const sorted = [...series].sort((a, b) => a.t - b.t);
  const now = sorted[sorted.length - 1];
  const before = sorted.filter((p) => p.t <= launchMs).at(-1);
  if (before && launchMs - before.t <= AT_LAUNCH_WINDOW_MS) {
    /* A difference across a rounded figure ("74K") is not a count of videos. */
    const added = now.t > before.t && !now.rounded && !before.rounded ? now.uses - before.uses : null;
    return { kind: "atLaunch", atLaunch: before, now, added };
  }
  const after = sorted.find((p) => p.t > launchMs);
  if (after) return { kind: "firstAfter", firstAfter: after, now };
  return { kind: "none" };
}
