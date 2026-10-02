/**
 * When a creator's headline figures were measured, and by what (plan A2/A6).
 *
 * Creator.followersCount and Creator.averageViews carry no timestamp of their
 * own. They are written by two readers that DO stamp their reads -- the daily
 * roster refresh (CreatorProfileLink.refreshedAt, primary account only) and the
 * tracker sweep (CreatorTrackerSnapshot.recordedAt, in the same transaction) --
 * and by two that do not: a hand edit on the creator page, and an import.
 *
 * So the age is inferred, and only where it can be stood behind: a stamped read
 * counts as the figure's time only when the count it read IS the count on the
 * row. A hand-edited or imported figure matches neither and gets no age -- the
 * screen says "time not recorded" instead of borrowing the time of a read that
 * did not produce it. Of two matching reads the newer wins.
 *
 * A read that FAILED does not date the figure either: profileRefresh stamps
 * refreshedAt on a failure too, so after one the figure on screen is the last
 * good value from an earlier read whose time was overwritten. The tracker's
 * newest snapshot can still date it when it matches; otherwise it is said
 * plainly ("last read failed").
 *
 * Client-safe: plain data in, plain data out.
 */
import type { AgeField } from "@/lib/dataAge";

export type FigureTime = {
  /** When the figure was measured; null when that is not known. */
  at: Date | null;
  /** What measured it, for the tooltip and an export's Source column. */
  source: string;
  /** Which cadence it is read on (lib/dataAge), for the Stale rule. */
  field: AgeField;
  /** What to say instead of an age when `at` is null. */
  missing: string;
};

/** The same, as JSON-safe props for a client component. */
export type FigureTimeDto = Omit<FigureTime, "at"> & { at: string | null };

export const SOURCE_PROFILE_READ = "Profile read";
export const SOURCE_TRACKER_READ = "Tracker reading";
export const SOURCE_TRACKED_POSTS = "Tracked posts";
export const SOURCE_IMPORT = "CreatorCore import";

type LinkStamp = {
  followersCount?: number | null;
  averageViews?: number | null;
  refreshedAt?: Date | string | null;
  refreshError?: string | null;
};

type SnapshotStamp = {
  followersCount?: number | null;
  avgViews?: number | null;
  recordedAt: Date | string;
};

function toDate(at: Date | string | null | undefined): Date | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The same figure, allowing for a Float column and a rounded read. */
function sameFigure(a: number | null | undefined, b: number | null | undefined): boolean {
  return typeof a === "number" && typeof b === "number" && a > 0 && Math.round(a) === Math.round(b);
}

function newest(candidates: (Omit<FigureTime, "missing"> | null)[], missing: string, field: AgeField): FigureTime {
  let best: Omit<FigureTime, "missing"> | null = null;
  for (const c of candidates) {
    if (c?.at && (!best?.at || c.at > best.at)) best = c;
  }
  return best ? { ...best, missing } : { at: null, source: "Not recorded", field, missing };
}

/**
 * Followers (primary): the creator row's count, dated by whichever stamped read
 * produced it.
 */
export function creatorFollowersTime(f: {
  followersCount: number | null | undefined;
  primaryLink?: LinkStamp | null;
  latestSnapshot?: SnapshotStamp | null;
}): FigureTime {
  if (!(typeof f.followersCount === "number" && f.followersCount > 0)) {
    return { at: null, source: "Not read", field: "profile", missing: "not read yet" };
  }
  const link = f.primaryLink ?? null;
  const fromLink =
    link && !link.refreshError && sameFigure(link.followersCount, f.followersCount)
      ? { at: toDate(link.refreshedAt), source: SOURCE_PROFILE_READ, field: "profile" as const }
      : null;
  const snap = f.latestSnapshot ?? null;
  const fromSnapshot =
    snap && sameFigure(snap.followersCount, f.followersCount)
      ? { at: toDate(snap.recordedAt), source: SOURCE_TRACKER_READ, field: "tracker" as const }
      : null;
  return newest([fromLink, fromSnapshot], link?.refreshError ? "last read failed; time not recorded" : "time not recorded", "profile");
}

/**
 * Avg. views as the roster shows it: measured from tracked posts (dated by the
 * newest of their reads), else the account's own page (dated like followers).
 */
export function creatorAvgViewsTime(f: {
  /** The posts-derived mean, with the newest read among the posts behind it. */
  derived?: { value: number; asOf: Date | string | null; source?: string } | null;
  averageViews: number | null | undefined;
  primaryLink?: LinkStamp | null;
  latestSnapshot?: SnapshotStamp | null;
}): FigureTime {
  if (f.derived) {
    const at = toDate(f.derived.asOf);
    return {
      at,
      source: f.derived.source ?? SOURCE_TRACKED_POSTS,
      field: "post",
      missing: "posts not read by us yet",
    };
  }
  if (!(typeof f.averageViews === "number" && f.averageViews > 0)) {
    return { at: null, source: "Not read", field: "profile", missing: "not read yet" };
  }
  const link = f.primaryLink ?? null;
  const fromLink =
    link && !link.refreshError && sameFigure(link.averageViews, f.averageViews)
      ? { at: toDate(link.refreshedAt), source: SOURCE_PROFILE_READ, field: "profile" as const }
      : null;
  const snap = f.latestSnapshot ?? null;
  const fromSnapshot =
    snap && sameFigure(snap.avgViews, f.averageViews)
      ? { at: toDate(snap.recordedAt), source: SOURCE_TRACKER_READ, field: "tracker" as const }
      : null;
  return newest([fromLink, fromSnapshot], link?.refreshError ? "last read failed; time not recorded" : "time not recorded", "profile");
}

/** One roster account's own follower count, dated by its own last good read. */
export function linkFollowersTime(link: LinkStamp): FigureTime {
  if (!(typeof link.followersCount === "number" && link.followersCount > 0)) {
    return { at: null, source: "Not read", field: "profile", missing: "not read yet" };
  }
  if (link.refreshError) {
    return { at: null, source: "Not recorded", field: "profile", missing: "last read failed; time not recorded" };
  }
  const at = toDate(link.refreshedAt);
  return at
    ? { at, source: SOURCE_PROFILE_READ, field: "profile", missing: "time not recorded" }
    : { at: null, source: "Not recorded", field: "profile", missing: "not read by us yet" };
}

export function figureTimeDto(t: FigureTime): FigureTimeDto {
  return { ...t, at: t.at ? t.at.toISOString() : null };
}
