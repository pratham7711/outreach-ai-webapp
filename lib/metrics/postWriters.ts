import type { MetricField as PostCounter } from "@/lib/metricDisplay";
import type { PostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { mayOverwrite, sourceRank, type MetricField, type MetricSource } from "@/lib/metrics/fieldSources";

/**
 * One writer per post counter (plan A7), at the one place counters are written.
 *
 * A post's views can come from the creator's own connection (TikTok's Display
 * API, Instagram's Graph with their token) or from a public read of the page,
 * and the sync used to write whichever answered last. A creator whose token
 * read 48,210 views at nine could have a public scrape put 47.9K over it at
 * ten, and the post's history then showed a drop that was only a change of
 * source.
 *
 * Nothing on the post said which source wrote a counter, so this keeps that
 * note in the platformMetrics bag beside __measured -- a key in a column that
 * already exists, never a new column -- and asks mayOverwrite before each write.
 * A post with no note (everything written before this, and anything imported)
 * has no known writer, so any listed source may write it, as before.
 */

/** Where the per-counter writer note lives in Post.platformMetrics. */
export const METRIC_WRITERS_KEY = "__writers";

export type WriterNote = { source: MetricSource; at: string };
export type WriterNotes = Partial<Record<PostCounter, WriterNote>>;

type CounterColumn = "viewsCount" | "likesCount" | "commentsCount" | "sharesCount" | "savesCount" | "reachCount";

/** Every counter a fetch can carry, with its column and its FIELD_SOURCES rule. */
export const POST_COUNTERS: readonly { counter: PostCounter; column: CounterColumn; field: MetricField }[] = [
  { counter: "views", column: "viewsCount", field: "post.views" },
  { counter: "likes", column: "likesCount", field: "post.likes" },
  { counter: "comments", column: "commentsCount", field: "post.comments" },
  { counter: "shares", column: "sharesCount", field: "post.shares" },
  { counter: "saves", column: "savesCount", field: "post.saves" },
  { counter: "reach", column: "reachCount", field: "post.reach" },
];

/** The counters `m` carries a number for. */
export function countersIn(m: Partial<PostMetrics>): PostCounter[] {
  return POST_COUNTERS.filter(({ column }) => typeof m[column] === "number").map(({ counter }) => counter);
}

const SOURCES: readonly MetricSource[] = ["connected", "public", "manual"];

/** The stored notes. One that cannot be read is dropped rather than trusted:
 *  an unparseable time would otherwise never age out and pin the counter. */
export function writerNotes(platformMetrics: unknown): WriterNotes {
  if (typeof platformMetrics !== "object" || platformMetrics === null) return {};
  const raw = (platformMetrics as Record<string, unknown>)[METRIC_WRITERS_KEY];
  if (typeof raw !== "object" || raw === null) return {};
  const notes: WriterNotes = {};
  for (const { counter } of POST_COUNTERS) {
    const note = (raw as Record<string, unknown>)[counter];
    if (typeof note !== "object" || note === null) continue;
    const { source, at } = note as Record<string, unknown>;
    if (!SOURCES.includes(source as MetricSource) || typeof at !== "string") continue;
    if (!Number.isFinite(Date.parse(at))) continue;
    notes[counter] = { source: source as MetricSource, at };
  }
  return notes;
}

/**
 * The fetch with each counter that may not be written replaced by the stored
 * one, and the notes to store after it.
 *
 * A counter is held when the stored note names a better source still inside
 * the field's freshness window; it keeps the stored value, so the post, the
 * snapshot and the engagement rate all go on describing the trusted reading.
 * A held counter whose stored value the caller did not load cannot be kept in
 * place, so it is dropped from the write and returned in `held`, for the
 * caller to keep it listed as measured. A counter from a source its field does
 * not list at all (a public reach) is simply dropped. The incoming engagement
 * rate is dropped whenever anything was: it was worked out from numbers that
 * were not written.
 *
 * Every counter a fetch did carry is marked "public" unless the fetcher named
 * it in `connectedCounters`.
 */
export function rankPostCounters(
  metrics: PostMetrics,
  stored: Partial<Record<CounterColumn, number>>,
  platformMetrics: unknown,
  now: Date,
): { metrics: PostMetrics; notes: WriterNotes; held: PostCounter[] } {
  const previous = writerNotes(platformMetrics);
  const notes: WriterNotes = { ...previous };
  const connected = new Set(metrics.connectedCounters ?? []);
  const held: PostCounter[] = [];
  let out: PostMetrics | null = null;

  for (const { counter, column, field } of POST_COUNTERS) {
    if (typeof metrics[column] !== "number") continue;
    const source: MetricSource = connected.has(counter) ? "connected" : "public";
    const current = previous[counter];
    const allowed = current
      ? mayOverwrite(field, { source: current.source, writtenAt: new Date(current.at) }, { source }, now)
      : sourceRank(field, source) !== null;
    if (allowed) {
      notes[counter] = { source, at: now.toISOString() };
      continue;
    }
    out = out ?? { ...metrics };
    const kept = current ? stored[column] : undefined;
    if (typeof kept === "number") {
      out[column] = kept;
    } else {
      delete out[column];
      if (current) held.push(counter);
    }
  }

  if (out) delete out.engagementRate;
  return { metrics: out ?? metrics, notes, held };
}
