import { measuredFields } from "@/lib/metricDisplay";
import { writerNotes } from "@/lib/metrics/postWriters";
import { FIELD_SOURCES } from "@/lib/metrics/fieldSources";

type ViewsPost = {
  platform: string;
  postUrl?: string | null;
  mediaType?: string | null;
  viewsCount?: number | null;
  platformMetrics?: unknown;
};

export function hasMeasuredViews(post: ViewsPost): boolean {
  if (typeof post.viewsCount === "number" && post.viewsCount > 0) return true;
  return measuredFields(post.platformMetrics)?.includes("views") === true;
}

/**
 * An Instagram video whose views have never been read. Business Discovery is the
 * only public source of them, so these are the posts a limited budget must be
 * spent on first. A photo or carousel publishes no views and is never one.
 */
export function lacksViews(post: ViewsPost): boolean {
  if (post.platform !== "INSTAGRAM") return false;
  const video =
    post.mediaType === "REEL" || post.mediaType === "VIDEO" || /\/(reels?|tv)\//.test(post.postUrl ?? "");
  if (!video) return false;
  return !hasMeasuredViews(post);
}

/**
 * Views read inside their freshness window (lib/metrics/fieldSources, post.views),
 * so another Business Discovery read would only repeat them.
 */
export function viewsFresh(post: ViewsPost, now: Date = new Date()): boolean {
  if (!hasMeasuredViews(post)) return false;
  const at = writerNotes(post.platformMetrics).views?.at;
  const measuredAt = at ? new Date(at).getTime() : NaN;
  return Number.isFinite(measuredAt) && now.getTime() - measuredAt <= FIELD_SOURCES["post.views"].freshnessMs;
}

/** Above this share of Meta's hourly usage, posts with fresh views are not re-read. */
export const FRESH_VIEWS_SKIP_PERCENT = 60;
