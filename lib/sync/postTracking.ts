import {
  DEFAULT_POST_TRACKING,
  POST_TTL_MAX_DAYS,
  POST_TTL_MIN_DAYS,
  READ_CADENCE_HOURS,
  clampTtlDays,
  postTrackingExpiry,
  type PostTrackingGranularity,
  type ReadCadence,
} from "@/lib/trackers/granularity";
import { SEAL_AGE_HOURS } from "@/lib/sync/cadence";

export { POST_TTL_MAX_DAYS, POST_TTL_MIN_DAYS, clampTtlDays, postTrackingExpiry };

/**
 * Whether the cron reads a post this run, and on what grounds.
 *
 * This replaces the campaign-driven ladder in lib/sync/cadence.ts for the cron
 * path. The old model asked "is this campaign due, and how old is this post";
 * both halves were wrong for what the product now sells.
 *
 * The campaign half was wrong twice over, and it is worth being exact about
 * which half did the damage, because the obvious culprit is not the main one.
 * Measured on prod 2026-09-09, that gate's candidate set was 103 posts out of
 * 18,787 live ones. The dominant exclusion is the campaign STATUS filter: 497 of
 * ~500 campaigns are COMPLETE, and a COMPLETE campaign's posts were never swept
 * whatever their interval said. CreatorCore's 9999 = "never" sentinel sits on
 * top of that and turns out to be irrelevant for live campaigns -- counted both
 * ways, honouring it and ignoring it, the live untracked set is the same 102
 * posts, because no IN_PROGRESS campaign carries it.
 *
 * Both are gone now, and neither expressed a decision anyone made: the status
 * filter read "the campaign finished" as "nobody wants these numbers", and the
 * sentinel arrived with an importer.
 *
 * The post half was wrong because it keyed off `postedAt` -- a publish date has
 * no opinion about whether anyone still wants the numbers, which is how a
 * 180-day horizon came to be doing the job of a user preference.
 *
 * So what decides now is the tracker the user actually created -- it is on, it
 * has not expired, and its cadence says it is due -- plus the two automatic
 * reasons described under postCoverage below, which a user can switch off.
 */
export type PostTrackingAction = "sync" | "skip" | "seal";

export type PostTrackingDecision = { action: PostTrackingAction; reason: string };

export type PostTrackingInput = {
  trackingEnabled: boolean;
  trackingStartedAt: Date | null;
  /** The TTL end. Null on rows that predate the column — see effectiveExpiry. */
  trackingExpiresAt: Date | null;
  trackingTtlDays: number | null;
  lastSyncedAt: Date | null;
  /** When we last ASKED, from the __lastFetch stamp. A post that never measures
   *  must still be throttled, or it becomes the one row retried on every run. */
  lastAttemptAt?: Date | null;
  /** The reason that attempt recorded, from the same stamp. */
  lastReason?: string | null;
  syncDisabledAt: Date | null;
  hasFinalSnapshot: boolean;
  granularity: PostTrackingGranularity;
  now: Date;
  /** When the post went up. Absent, nothing is read on the strength of its age. */
  postedAt?: Date | null;
  /** Whether its campaign is still running -- see isLiveCampaign. */
  campaignLive?: boolean;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/* A cron that fires at 06:00:10 must not defer a 6-hourly post read taken at
   00:05 by a whole cycle -- and since 2026-09-09 a whole cycle is six hours,
   not one, so the old five minutes was far too tight: any read that landed
   more than five minutes into a sweep lost its next slot entirely.

   Thirty minutes cannot cause a double read. The cron fires every six hours,
   so between two consecutive fires the elapsed time grows by exactly six
   hours; a tracker can therefore come up due at most once per fire no matter
   how wide this is. Grace only ever prevents a skipped cycle. It is sized
   above the 300s function ceiling so a read taken at the very end of a long
   sweep still keeps its slot. */
const DUE_GRACE_MS = 30 * 60 * 1000;

/* A post its creator hid ("post-hidden") is asked about once a day, whatever
   the org's cadence: often enough to notice it coming back, and no more, since
   until it does every read returns the same refusal. */
const HIDDEN_RECHECK_HOURS = 24;

/**
 * Answers that stand until a person acts -- the creator shows the post again,
 * makes the account professional or reconnects it, or an operator replaces a
 * token -- so every read until then gets the same refusal. They are asked
 * about once a day, as a hidden post is, and the sweep puts them behind every
 * readable candidate (sweepCandidates). On 2026-10-03 (read-only) 119 tracked
 * Instagram posts stood on one of these or on "platform-refused" -- 59 not a
 * professional account, 28 credentials rejected, 32 refused -- against a
 * budget of 100 reads a run, and the oldest-read-first order put them first.
 */
export const DAILY_RECHECK_REASONS: ReadonlySet<string> = new Set([
  "post-hidden",
  "not-a-professional-account",
  "not-on-account",
  "credentials-rejected",
]);

/**
 * The expiry to enforce, including for rows written before the column existed.
 *
 * A tracked post with a null `trackingExpiresAt` is not treated as expired.
 * Sealing those on the first run after deploy would retire every currently
 * tracked post at once, permanently — the seal is one-way. It is read instead as
 * "started, TTL never recorded", and the org default is applied from whenever
 * tracking began. A tracker with neither timestamp is treated as starting now,
 * which gives it a full window rather than none.
 */
export function effectiveExpiry(input: PostTrackingInput): Date {
  if (input.trackingExpiresAt) return input.trackingExpiresAt;
  const from = input.trackingStartedAt ?? input.now;
  return postTrackingExpiry(
    from,
    clampTtlDays(input.trackingTtlDays, input.granularity.defaultTtlDays),
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Coverage: every reason the cron reads a post, not only the tracker.
 *
 * A tracker is something a person switches on, and on production almost nobody
 * does: measured 2026-10-03, 0 of the 154 posts in the 9 IN_PROGRESS campaigns
 * had one, and of 752 readable posts published in the last 30 days, 9 did. The
 * 18,604 trackers that do exist were all switched on in one minute
 * (2026-09-15 16:05 UTC, 503 campaigns), almost all on finished campaigns'
 * back catalogue. So the posts a client is watching move only when someone
 * presses Refresh Data, while the sweep spends itself on two-year-old TikToks.
 *
 * Two more reasons now cover a post, neither needing a write:
 *
 *   - new-post: every post in its first AUTO_TRACK_DAYS, whatever its
 *     campaign's status. Views grow fastest in a post's first days, and
 *     CreatorCore-imported campaigns are marked COMPLETE the moment the
 *     deliverables land -- measured the same day, one COMPLETE campaign's 121
 *     Instagram posts had gone up that morning -- so "the campaign is running"
 *     cannot be the only test. Read every 6h for its first week and daily after,
 *     which is the ladder lib/dataAge's Stale chip already holds a post to.
 *   - campaign: a post of a live campaign, at the org's cadence, up to
 *     LIVE_CAMPAIGN_HORIZON_DAYS old, so a campaign left open forever cannot
 *     read forever.
 *
 * Both are switched off by the same Stop the tracker uses. Stopping writes
 * `trackingExpiresAt` with `trackingEnabled` false -- "tracking ended then" --
 * which a post nobody ever tracked (both null) cannot be mistaken for. Rows
 * untracked before that write existed are all-null and read as never tracked;
 * none of the 154 posts in running campaigns carries the `track-enable` reading
 * a single-post track leaves behind, so none shows signs of having been
 * stopped by hand (measured 2026-10-03).
 *
 * The automatic reasons never seal. A seal is the end of a tracker, and is
 * one-way; a post that ages out of its first month, or whose campaign
 * completes, simply stops being read and keeps every reading it had.
 * ──────────────────────────────────────────────────────────────────────────── */

export type TrackingSource = "tracker" | "campaign" | "new-post";

/** A post is read automatically for this long after it goes up -- the same
 *  window a tracker gets by default. */
export const AUTO_TRACK_DAYS = DEFAULT_POST_TRACKING.defaultTtlDays;
/** Of which the first week is read at the 6-hourly floor, and the rest daily. */
export const AUTO_TRACK_FAST_DAYS = 7;
const AUTO_FAST_CADENCE: ReadCadence = "6hourly";
const AUTO_SLOW_CADENCE: ReadCadence = "daily";

/** A live campaign's posts are read up to this old, and no older. */
export const LIVE_CAMPAIGN_HORIZON_DAYS = SEAL_AGE_HOURS / 24;
/** Past this age a tracker seals once it has one reading of its own. */
export const OLD_POST_DAYS = SEAL_AGE_HOURS / 24;

/** Campaign statuses whose posts are read with or without a tracker. PENDING is
 *  included because it is the same "still live" set the old campaign gate and
 *  app/api/admin/unseal-live-posts use. */
export const LIVE_CAMPAIGN_STATUSES = ["IN_PROGRESS", "PENDING"] as const;

export function isLiveCampaign(
  campaign: { status?: string | null; archived?: boolean | null; deletedAt?: Date | string | null } | null | undefined,
): boolean {
  if (!campaign || campaign.deletedAt || campaign.archived) return false;
  return (LIVE_CAMPAIGN_STATUSES as readonly string[]).includes(campaign.status ?? "");
}

/** Tracking was stopped by hand, as opposed to never started. */
export function trackingStopped(post: { trackingEnabled: boolean; trackingExpiresAt: Date | null }): boolean {
  return !post.trackingEnabled && post.trackingExpiresAt != null;
}

/**
 * A post last read at or after this is not yet due at `cadence`. The candidate
 * query filters on it so posts read last run do not take places in the queue
 * that a due post needs; decidePostTracking still has the last word.
 */
export function dueCutoff(now: Date, cadence: ReadCadence): Date {
  return new Date(now.getTime() - (READ_CADENCE_HOURS[cadence] * HOUR_MS - DUE_GRACE_MS));
}

/** What the new-post reason reads at, for a post this many days old. */
export function newPostCadence(ageDays: number): ReadCadence {
  return ageDays < AUTO_TRACK_FAST_DAYS ? AUTO_FAST_CADENCE : AUTO_SLOW_CADENCE;
}

export type PostCoverage =
  | {
      covered: true;
      /** The reason that lasts longest -- what the UI names. */
      source: TrackingSource;
      /** When reading stops, if nothing changes; null while a campaign runs. */
      expiresAt: Date | null;
      /** The fastest cadence among the reasons, and whose it is. */
      cadence: ReadCadence;
      cadenceSource: TrackingSource;
      /** Only an old post's tracker holds it, so its next reading is its last. */
      sealsOnNextRead: boolean;
    }
  | {
      covered: false;
      reason: "dead-letter" | "sealed" | "stopped" | "not-tracked" | "ttl-expired" | "age-over-180d";
    };

/** Read since the tracker started. A tracker with no start reads as begun before any reading. */
function measuredSinceStart(input: PostTrackingInput): boolean {
  if (!input.lastSyncedAt) return false;
  return !input.trackingStartedAt || input.lastSyncedAt.getTime() >= input.trackingStartedAt.getTime();
}

export function postCoverage(input: PostTrackingInput): PostCoverage {
  if (input.syncDisabledAt) return { covered: false, reason: "dead-letter" };
  if (input.hasFinalSnapshot) return { covered: false, reason: "sealed" };

  const now = input.now.getTime();
  const posted = input.postedAt ? input.postedAt.getTime() : null;
  const ageMs = posted === null || Number.isNaN(posted) ? null : now - posted;
  const live = input.campaignLive === true;
  const orgCadence = input.granularity.readCadence;

  type Reason = { source: TrackingSource; cadence: ReadCadence; ends: number };
  const reasons: Reason[] = [];
  let trackerOver: "ttl-expired" | "age-over-180d" | null = null;

  if (input.trackingEnabled) {
    const expiry = effectiveExpiry(input).getTime();
    /* Expiry before cadence, so a window that closed between runs seals on the
       next one rather than waiting for the post to come due. */
    if (now >= expiry) trackerOver = "ttl-expired";
    /* An old post's numbers have stopped moving, so its tracker earns one
       reading and then seals on it: the final snapshot is a fresh number, and
       the post stops costing anything. Not while its campaign runs. */
    else if (!live && ageMs !== null && ageMs > OLD_POST_DAYS * DAY_MS && measuredSinceStart(input)) {
      trackerOver = "age-over-180d";
    } else reasons.push({ source: "tracker", cadence: orgCadence, ends: expiry });
  }

  if (!trackingStopped(input)) {
    if (live && (ageMs === null || ageMs <= LIVE_CAMPAIGN_HORIZON_DAYS * DAY_MS)) {
      reasons.push({ source: "campaign", cadence: orgCadence, ends: Infinity });
    }
    if (ageMs !== null && ageMs < AUTO_TRACK_DAYS * DAY_MS) {
      reasons.push({
        source: "new-post",
        cadence: newPostCadence(ageMs / DAY_MS),
        ends: (posted as number) + AUTO_TRACK_DAYS * DAY_MS,
      });
    }
  }

  if (reasons.length === 0) {
    if (trackerOver) return { covered: false, reason: trackerOver };
    return { covered: false, reason: trackingStopped(input) ? "stopped" : "not-tracked" };
  }

  /* Ties go to the earlier entry: the tracker, then the campaign. */
  const longest = reasons.reduce((a, b) => (b.ends > a.ends ? b : a));
  const fastest = reasons.reduce((a, b) =>
    READ_CADENCE_HOURS[b.cadence] < READ_CADENCE_HOURS[a.cadence] ? b : a,
  );
  return {
    covered: true,
    source: longest.source,
    expiresAt: Number.isFinite(longest.ends) ? new Date(longest.ends) : null,
    cadence: fastest.cadence,
    cadenceSource: fastest.source,
    sealsOnNextRead: !live && ageMs !== null && ageMs > OLD_POST_DAYS * DAY_MS,
  };
}

/** What the UI calls the reason a post is read. `final-read` is a tracker on a
 *  post past 180 days, which reads once more and seals on that reading. */
export type TrackingSourceView = TrackingSource | "final-read";

export type TrackingView = {
  /** Whether the cron will read this post again -- not whether a tracker row
   *  is switched on. A post read automatically is tracked; a tracker whose
   *  window has closed is not, though the seal that records it is a run away. */
  trackingEnabled: boolean;
  trackingExpiresAt: Date | null;
  trackingSource: TrackingSourceView | null;
  readCadence: ReadCadence | null;
};

export function trackingView(input: PostTrackingInput): TrackingView {
  const c = postCoverage(input);
  if (!c.covered) return { trackingEnabled: false, trackingExpiresAt: null, trackingSource: null, readCadence: null };
  return {
    trackingEnabled: true,
    trackingExpiresAt: c.expiresAt,
    trackingSource: c.sealsOnNextRead ? "final-read" : c.source,
    readCadence: c.cadence,
  };
}

/** The seal a decision asked for, by what ended it. `cron-seal-ttl` is what
 *  lib/sync/unsealMisfiredTtl keys on, so an age seal must not share it. */
export function sealSource(reason: string): string {
  return reason === "age-over-180d" ? "cron-seal-age" : "cron-seal-ttl";
}

export function decidePostTracking(input: PostTrackingInput): PostTrackingDecision {
  const coverage = postCoverage(input);
  if (!coverage.covered) {
    return coverage.reason === "ttl-expired" || coverage.reason === "age-over-180d"
      ? { action: "seal", reason: coverage.reason }
      : { action: "skip", reason: coverage.reason };
  }

  /* The later of "last measured" and "last attempted". Answering "how long
     since we spent a request on this" with successes only made failure
     self-perpetuating: a post that never measures would never be throttled. */
  const lastTouchMs = Math.max(
    input.lastSyncedAt?.getTime() ?? -Infinity,
    input.lastAttemptAt?.getTime() ?? -Infinity,
  );
  if (lastTouchMs === -Infinity) return { action: "sync", reason: "never-read" };

  const cadenceHours = READ_CADENCE_HOURS[coverage.cadence];
  if (input.lastReason && DAILY_RECHECK_REASONS.has(input.lastReason) && cadenceHours < HIDDEN_RECHECK_HOURS) {
    /* "hidden-*" kept for the hidden post, so the run summaries stay comparable. */
    const kind = input.lastReason === "post-hidden" ? "hidden" : "answered";
    return input.now.getTime() - lastTouchMs >= HIDDEN_RECHECK_HOURS * HOUR_MS - DUE_GRACE_MS
      ? { action: "sync", reason: `${kind}-recheck` }
      : { action: "skip", reason: `${kind}-throttle` };
  }
  /* A tracker's reasons keep their old names, so the run summaries before and
     after this change stay comparable. */
  const label = coverage.cadenceSource === "tracker" ? coverage.cadence : `${coverage.cadenceSource}-${coverage.cadence}`;
  const dueAfterMs = cadenceHours * HOUR_MS;
  if (input.now.getTime() - lastTouchMs >= dueAfterMs - DUE_GRACE_MS) {
    return { action: "sync", reason: `cadence-${label}` };
  }
  return { action: "skip", reason: `cadence-throttle-${label}` };
}

/** Remaining window, in whole hours, for the UI to show next to a tracker. */
export function hoursRemaining(input: PostTrackingInput): number {
  const ms = effectiveExpiry(input).getTime() - input.now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / HOUR_MS);
}

export const POST_TRACKING_DEFAULTS = DEFAULT_POST_TRACKING;
