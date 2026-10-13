/**
 * How old a number is, and whether it is older than it should be (plan §13 A6).
 *
 * Every figure on a screen or in an export was read at some moment, and a
 * figure with no age reads as live. This is the one place that words an age
 * ("3h ago"), decides when a figure has gone stale, and stamps exports with
 * "Data as of …", so the roster, the creator page, the post screens, Trackers,
 * the spreadsheets and the share PDF cannot disagree about either.
 *
 * "Stale" is relative to how often the figure is MEANT to be read. A post read
 * 20 hours ago is fine if it is a month old and read daily, and late if it went
 * up yesterday and is read every six hours. So each kind of figure carries its
 * target cadence, taken from the code that schedules the read, and a figure is
 * stale once it is more than twice that old (the 10-01 data plan's rule: one
 * missed read is noise, two is a source that has stopped).
 *
 * A figure with no recorded time gets no age at all -- never a guessed one. The
 * caller says so in words ("not read yet"), because the absence is the fact.
 *
 * Client-safe: no database, no readers.
 */
import { formatDateTimeAbs, formatElapsed, UNKNOWN } from "@/lib/format";
import { DEFAULT_GRANULARITY, READ_CADENCE_HOURS } from "@/lib/trackers/granularity";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How far in the future a timestamp may sit and still read as "just now".
 *
 * A few minutes of clock skew between the database, the server and the browser
 * is normal, and calling it "in the future" helps nobody. Past that, a future
 * timestamp is bad data, and an age computed from it would claim a freshness
 * nothing measured -- so it gets no age.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** The kinds of figure the app shows, by what reads them. */
export type AgeField =
  /** A roster account's followers and average views, from the daily profile
   *  refresh (CreatorProfileLink.refreshedAt). */
  | "profile"
  /** A connected account's own statistics (CreatorSocialAccount.statsSyncedAt). */
  | "account"
  /** A tracked creator's reading (CreatorTrackerSnapshot.recordedAt). */
  | "tracker"
  /** A tracked sound's reading (SoundTrackerSnapshot.recordedAt). */
  | "sound"
  /** A campaign post's counters (Post.lastSyncedAt). */
  | "post"
  /** A creator's Top Posts (Creator.topPostsAt). */
  | "topPosts";

export type AgeContext = {
  /** The org's tracker read cadence, in hours, for "tracker" and "sound". */
  cadenceHours?: number | null;
  /** When the post went up, for "post": young posts are read more often. */
  postedAt?: string | Date | null;
  /** For "post": false when nothing reads the post any more (tracker off,
   *  expired, sealed or dead-lettered). Its numbers are final, not late. */
  tracked?: boolean | null;
};

/**
 * Target hours between reads, per kind of figure. Each is the cadence the
 * scheduling code actually runs, not an aspiration:
 *
 *  - profile: refresh-roster-profiles re-reads an account once
 *    PROFILE_REFRESH_MS (24h, lib/creators/profileRefresh) has passed.
 *  - account: refresh-platform-tokens runs daily (vercel.json, 05:00).
 *  - tracker / sound: the org's read cadence (lib/trackers/granularity),
 *    12-hourly unless the org chose otherwise.
 *  - post: the post sweep reads every post every 6h for its first week and
 *    daily to day 30 (postCoverage in lib/sync/postTracking); the cron itself
 *    fires every 6h. A tracker or a running campaign reads it at the org's
 *    cadence, which is never slower than daily.
 *  - topPosts: lib/creators/snapshot refreshes them once they pass 20h, so
 *    at most daily.
 */
export const AGE_TARGET_HOURS = {
  profile: 24,
  account: 24,
  topPosts: 24,
  postFirstWeek: 6,
  postAfterFirstWeek: 24,
} as const;

/** One missed read is noise; two is a source that has stopped. */
export const STALE_MULTIPLIER = 2;

function toDate(at: string | Date | null | undefined): Date | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The target read interval in hours, or null when nothing reads the figure on a schedule. */
export function targetHours(field: AgeField, ctx: AgeContext = {}, now: Date = new Date()): number | null {
  switch (field) {
    case "profile":
      return AGE_TARGET_HOURS.profile;
    case "account":
      return AGE_TARGET_HOURS.account;
    case "topPosts":
      return AGE_TARGET_HOURS.topPosts;
    case "tracker":
    case "sound": {
      const h = ctx.cadenceHours;
      return typeof h === "number" && Number.isFinite(h) && h > 0
        ? h
        : READ_CADENCE_HOURS[DEFAULT_GRANULARITY.readCadence];
    }
    case "post": {
      if (ctx.tracked === false) return null;
      const posted = toDate(ctx.postedAt);
      /* Unknown publish date: the slower rung, so an unknown never raises a
         Stale chip the faster one would not also raise. */
      if (!posted) return AGE_TARGET_HOURS.postAfterFirstWeek;
      const ageHours = (now.getTime() - posted.getTime()) / HOUR_MS;
      return ageHours > 7 * 24 ? AGE_TARGET_HOURS.postAfterFirstWeek : AGE_TARGET_HOURS.postFirstWeek;
    }
  }
}

/** Milliseconds after which a figure of this kind is stale, or null when it cannot be. */
export function staleAfter(field: AgeField, ctx: AgeContext = {}, now: Date = new Date()): number | null {
  const h = targetHours(field, ctx, now);
  return h === null ? null : h * STALE_MULTIPLIER * HOUR_MS;
}

/** Age in ms; null for a missing, unparseable or implausibly future timestamp. */
export function ageMs(at: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = toDate(at);
  if (!d) return null;
  const ms = now.getTime() - d.getTime();
  if (ms < -FUTURE_TOLERANCE_MS) return null;
  return Math.max(0, ms);
}

/** "3h ago", or null when there is no time to stand behind. */
export function formatAge(at: string | Date | null | undefined, now: Date = new Date()): string | null {
  const ms = ageMs(at, now);
  return ms === null ? null : formatElapsed(ms);
}

/** Whether a figure read at `at` is past twice its target. A figure with no time is not "stale" -- it is unread. */
export function isStale(
  at: string | Date | null | undefined,
  field: AgeField,
  ctx: AgeContext = {},
  now: Date = new Date(),
): boolean {
  const ms = ageMs(at, now);
  const limit = staleAfter(field, ctx, now);
  return ms !== null && limit !== null && ms > limit;
}

/** "2 Oct 2026, 14:05 UTC" -- the absolute time behind an age, for a tooltip or a PDF. */
export function formatAsOf(at: string | Date | null | undefined): string {
  const d = toDate(at);
  return d ? `${formatDateTimeAbs(d)} UTC` : UNKNOWN;
}

/**
 * The newest reading among many: what "Data as of" means for a report or an
 * export. Missing and implausibly future times are ignored; null when none.
 */
export function dataAsOf(times: Iterable<string | Date | null | undefined>, now: Date = new Date()): Date | null {
  let newest: Date | null = null;
  for (const t of times) {
    const d = toDate(t);
    if (!d || ageMs(d, now) === null) continue;
    if (!newest || d > newest) newest = d;
  }
  return newest;
}

/**
 * "Data as of 2 Oct 2026, 14:05 UTC", or a plain statement that nothing has
 * been read.
 *
 * With `coverage`, the line also says how many of the posts that time speaks
 * for. The newest reading alone overstated it: a report whose one read post
 * was synced this morning said "Data as of" this morning above four posts
 * whose figures were an import's, never read by us -- so it now names the
 * reading as the newest and says how many posts were read at all.
 */
export function dataAsOfLine(
  at: string | Date | null | undefined,
  coverage?: { read: number; total: number } | null,
): string {
  const d = toDate(at);
  if (!d) {
    return coverage && coverage.total > 0 ? "Data as of: no post read by us yet" : "Data as of: no readings yet";
  }
  if (!coverage || coverage.total <= 0 || coverage.read >= coverage.total) return `Data as of ${formatAsOf(d)}`;
  const rest = coverage.total - coverage.read;
  return `Data as of ${formatAsOf(d)}, the newest reading · ${coverage.read} of ${coverage.total} ${plural(coverage.total, "post")} read by us; the other ${rest} show imported figures or none`;
}

function plural(n: number, noun: string): string {
  return n === 1 ? noun : `${noun}s`;
}

/**
 * The small line under a total on a KPI tile: when its figures were read, and
 * -- when some are missing -- how many of the items it adds up it covers.
 *
 *   "as of 13 Oct 2026, 07:50 UTC · views known for 4 of 5 posts"
 *
 * `at` is the newest reading behind the total (dataAsOf over the items). A
 * total with nothing to date says "time not recorded" rather than borrowing
 * a time. Coverage is left out when it is complete, so a fully-read total
 * carries only its time. Null when there is nothing to say at all.
 */
export function asOfCaption(
  at: string | Date | null | undefined,
  coverage?: { known: number | null | undefined; total: number; noun?: string; what?: string } | null,
): string | null {
  const parts: string[] = [];
  const d = toDate(at);
  if (d && ageMs(d) !== null) parts.push(`as of ${formatAsOf(d)}`);
  /* Nothing known means nothing to date: "views known for 0 of 7 posts" says
     it, and "time not recorded" in front of it would suggest a reading. */
  else if (coverage && coverage.total > 0 && coverage.known !== 0) parts.push(TIME_NOT_RECORDED);
  if (coverage && typeof coverage.known === "number" && coverage.total > 0 && coverage.known < coverage.total) {
    parts.push(
      `${coverage.what ? `${coverage.what} ` : ""}known for ${coverage.known} of ${coverage.total} ${plural(coverage.total, coverage.noun ?? "post")}`,
    );
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The one phrase for a figure we hold but cannot date. The roster said "age
 * unknown", Trackers and the creator figures "time not recorded", and the
 * export "Age unknown" -- three wordings of one fact, read side by side.
 */
export const TIME_NOT_RECORDED = "time not recorded";

/**
 * An export's "As of" cell: ISO 8601 in UTC, which every spreadsheet and
 * parser reads as a time. "—" rather than an empty cell when nothing was
 * read, for the same reason lib/creators/metricValue never writes a blank.
 */
export function asOfCell(at: string | Date | null | undefined): string {
  const d = toDate(at);
  return d ? d.toISOString() : UNKNOWN;
}

/** An export's freshness status for a figure that is not a post: read, stale, or never read. */
export function freshnessCell(
  at: string | Date | null | undefined,
  field: AgeField,
  ctx: AgeContext = {},
  now: Date = new Date(),
): "Current" | "Stale" | "Not read" {
  if (ageMs(at, now) === null) return "Not read";
  return isStale(at, field, ctx, now) ? "Stale" : "Current";
}
