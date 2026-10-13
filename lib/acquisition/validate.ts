import { createLogger } from "@/lib/observability/logger";

/**
 * The one validation gate every metric write goes through (plan A3).
 *
 * A reading is what a reader brought back: a post's counters, a profile's
 * follower count, a sound's use count. Before any of it reaches a column it is
 * checked against the row it would land on, and a reading that cannot be right
 * is NOT written. The row keeps its previous value -- the last good figure,
 * still dated by its own read -- and the refusal is logged with a reason, so a
 * wrong number never replaces a right one and nothing is dropped silently.
 *
 * Pure and synchronous on purpose: no query, no clock, no platform call. Each
 * writer already holds both the reading and the row it is about to update, so
 * asking costs nothing, and the same rules apply on the cron, on Refresh, on the
 * ingest endpoints and in the importers without any of them growing a second
 * copy. The writers decide what a rejection means for them (skip the row, keep
 * one field, record the cause on the post); this module only says what is wrong.
 *
 * The hard rejects, every one of them a reading that is wrong rather than
 * surprising:
 *
 *   fell-to-zero        a count that was above zero and now reads exactly 0.
 *                       Lifetime counters do not do that; a page that was not
 *                       the post or the profile parses to 0. On 2026-09-19 a
 *                       TikTok post read 53,700 views and then a measured 0,
 *                       and three creators were written at 0 followers on
 *                       2026-10-02. Absent is not 0: a reading that simply did
 *                       not carry the count says nothing and passes.
 *   engagement-exceeds-views
 *                       more likes (comments, shares, saves) than views, when
 *                       the reading carried both. Every one of them needs a
 *                       view first. See lib/metrics/coherence.
 *   platform-mismatch   the reading is about a different platform from the row
 *                       it would land on -- an Instagram author's follower
 *                       count is not a TikTok creator's.
 *   account-mismatch    the reading answered for a different account from the
 *                       one the row is bound to, where a binding exists: a
 *                       handle that now belongs to someone else, a token that
 *                       resolves to a sibling Page, a repost by another author.
 *   parser-shell        the reader parsed a WAF, login or challenge page
 *                       rather than data: markup or a challenge token where a
 *                       title should be, or a reader that said so itself.
 *
 * What it deliberately does NOT do is judge a surprising figure. A drop of
 * more than half or a 3x jump can be real (a bot purge, a viral week); those
 * need a second read to confirm, which needs somewhere to keep the first, and
 * that is ReadingQuarantine (plan A3/A4, the schema proposal). The tracker
 * already has its own hold for followers (lib/trackers/readingGate) and the
 * sound sweep its own for falls (holdSoundReading); this gate runs beside them.
 */

/** Every figure the gate knows how to judge. */
export type GateCounter =
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "reach"
  | "followers"
  | "avgViews"
  | "posts"
  | "uses";

export type GateRule =
  | "fell-to-zero"
  | "engagement-exceeds-views"
  | "platform-mismatch"
  | "account-mismatch"
  | "parser-shell";

/**
 * What kind of row the reading lands on. Decides which counter is the row's
 * headline: a headline that falls to 0 voids the whole reading (nothing else in
 * a page that read 0 views can be trusted), while a secondary counter that
 * falls to 0 is dropped alone and the rest of the reading still lands.
 */
export type GateKind = "post" | "creator" | "account" | "sound" | "top-post";

const HEADLINE: Record<GateKind, GateCounter | null> = {
  post: "views",
  creator: "followers",
  account: "followers",
  sound: "uses",
  "top-post": null,
};

export type GateReading = {
  kind: GateKind;
  /** The platform the reading says it describes. Absent: it did not say. */
  platform?: string | null;
  /** The platform account it answered for, when the reader carried one. */
  accountId?: string | null;
  /** The figures it carried. A missing, null or non-finite value was not read. */
  counts: Partial<Record<GateCounter, number | null | undefined>>;
  /** Short metadata the reader parsed (a title, an artist, a handle) -- the
   *  fields a shell page fills with its own text. Never a caption: a creator
   *  can write anything in one. */
  labels?: (string | null | undefined)[];
  /** The reader itself knows it parsed a shell. */
  shell?: boolean;
};

export type GateRow = {
  /** The row's platform. Absent: not loaded, and the rule does not apply. */
  platform?: string | null;
  /** The account ids the row is bound to. Empty or absent: no binding exists,
   *  and the reading cannot contradict one. */
  boundAccountIds?: readonly (string | null | undefined)[] | null;
  /** The figures already on the row: the last good reading. A missing value
   *  means the caller did not load it, or it was never measured. */
  counts?: Partial<Record<GateCounter, number | null | undefined>>;
};

export type GateRejection = {
  rule: GateRule;
  /** Set when the rejection concerns one counter only. */
  field?: GateCounter;
  /** True when nothing in the reading may be written. False: drop `field`. */
  whole: boolean;
  detail: string;
};

export type GateVerdict = {
  /** Nothing wrong: write the reading as it is. */
  ok: boolean;
  /** At least one rejection voids the whole reading. */
  rejected: boolean;
  /** Counters to leave out of the write, keeping the row's previous value. */
  dropFields: GateCounter[];
  rejections: GateRejection[];
};

const ENGAGEMENT: GateCounter[] = ["likes", "comments", "shares", "saves"];

/* Text a WAF, login wall or challenge page puts where a reader expected a title.
   Matched on exact, page-shaped tokens only: markup, the WAF's own markers, and
   the platforms' login and interstitial page titles verbatim. A loose word list
   ("captcha", "just a moment") would refuse a real song called that. */
const SHELL_MARKERS: RegExp[] = [
  /<\s*(?:!doctype|html|head|body|script)\b/i,
  /SlardarWAF|_wafchallengeid|wafchallenge|__cf_chl_|cf-browser-verification/i,
];
const SHELL_TITLES: ReadonlySet<string> = new Set(
  [
    "TikTok - Make Your Day",
    "Log in | TikTok",
    "Login • Instagram",
    "Instagram",
    "Sign in - Google Accounts",
    "Before you continue to YouTube",
    "Just a moment...",
    "Attention Required! | Cloudflare",
    "Access Denied",
  ].map((t) => t.toLowerCase()),
);

function known(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** Whether a short parsed label is the text of a shell page rather than data. */
export function isShellLabel(label: string | null | undefined): boolean {
  if (typeof label !== "string" || !label.trim()) return false;
  if (SHELL_TITLES.has(label.trim().toLowerCase())) return true;
  return SHELL_MARKERS.some((re) => re.test(label));
}

/** The verdict for one reading against the row it would land on. */
export function validateReading(reading: GateReading, row: GateRow = {}): GateVerdict {
  const rejections: GateRejection[] = [];
  const headline = HEADLINE[reading.kind];

  if (reading.shell === true) {
    rejections.push({ rule: "parser-shell", whole: true, detail: "the reader parsed a shell page, not data" });
  } else {
    const shellLabel = (reading.labels ?? []).find((l) => isShellLabel(l));
    if (shellLabel !== undefined) {
      rejections.push({
        rule: "parser-shell",
        whole: true,
        detail: `a shell page's text where data was expected: "${String(shellLabel).slice(0, 60)}"`,
      });
    }
  }

  if (reading.platform && row.platform && norm(reading.platform) !== norm(row.platform)) {
    rejections.push({
      rule: "platform-mismatch",
      whole: true,
      detail: `${norm(reading.platform)} reading for a ${norm(row.platform)} row`,
    });
  }

  const bound = (row.boundAccountIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (reading.accountId && bound.length > 0 && !bound.includes(reading.accountId)) {
    rejections.push({
      rule: "account-mismatch",
      whole: true,
      detail: `answered for account ${reading.accountId}, the row is bound to ${bound.join(", ")}`,
    });
  }

  const c = reading.counts;
  if (known(c.views)) {
    const over = ENGAGEMENT.filter((f) => known(c[f]) && (c[f] as number) > (c.views as number));
    if (over.length > 0) {
      rejections.push({
        rule: "engagement-exceeds-views",
        whole: true,
        detail: `${over.map((f) => `${f} ${c[f]}`).join(", ")} over views ${c.views}`,
      });
    }
  }

  const stored = row.counts ?? {};
  for (const field of Object.keys(c) as GateCounter[]) {
    const next = c[field];
    const prev = stored[field];
    if (next === 0 && known(prev) && prev > 0) {
      rejections.push({
        rule: "fell-to-zero",
        field,
        whole: field === headline,
        detail: `${field} fell to 0 from ${Math.round(prev)}`,
      });
    }
  }

  const rejected = rejections.some((r) => r.whole);
  const dropFields = rejected
    ? []
    : Array.from(new Set(rejections.filter((r) => r.field).map((r) => r.field as GateCounter)));
  return { ok: rejections.length === 0, rejected, dropFields, rejections };
}

/** A copy of `counts` without the fields the verdict dropped. */
export function withoutDropped<T extends Record<string, unknown>>(
  counts: T,
  verdict: GateVerdict,
  columnOf: Partial<Record<GateCounter, keyof T>>,
): T {
  if (verdict.dropFields.length === 0) return counts;
  const out = { ...counts };
  for (const field of verdict.dropFields) {
    const column = columnOf[field];
    if (column !== undefined) delete out[column];
  }
  return out;
}

/** One line per refusal, the same shape from every writer, for a log search. */
export function describeVerdict(verdict: GateVerdict): string {
  return verdict.rejections.map((r) => `${r.rule}: ${r.detail}`).join("; ");
}

export type GateLogContext = {
  /** Which writer refused it, e.g. "post-sync", "tracker", "sound-ingest". */
  writer: string;
  kind: GateKind;
  platform?: string | null;
  /** The row the reading would have landed on. */
  rowId?: string | null;
  orgId?: string | null;
  /** The reader or exit that produced it, when the writer knows. */
  via?: string | null;
};

/**
 * Log a verdict that refused something, as one structured warn line.
 *
 * `msg` is fixed ("reading rejected" / "reading field dropped") and every
 * refusal carries `gate: "acquisition.validate"`, so one log query finds every
 * refusal from every writer. Accepted readings are logged at debug only: the
 * hourly sweeps write thousands and an info line each would bury the refusals.
 */
export function logVerdict(ctx: GateLogContext, verdict: GateVerdict): void {
  const log = createLogger({ context: { gate: "acquisition.validate", writer: ctx.writer } });
  const base = {
    kind: ctx.kind,
    platform: ctx.platform ?? null,
    rowId: ctx.rowId ?? null,
    ...(ctx.orgId ? { orgId: ctx.orgId } : {}),
    ...(ctx.via ? { via: ctx.via } : {}),
  };
  if (verdict.ok) {
    log.debug("reading accepted", base);
    return;
  }
  log.warn(verdict.rejected ? "reading rejected" : "reading field dropped", {
    ...base,
    // One entry per rule and field, however many counters tripped it.
    rules: [...new Set(verdict.rejections.map((r) => r.rule))],
    fields: [...new Set(verdict.rejections.flatMap((r) => (r.field ? [r.field] : [])))],
    reason: describeVerdict(verdict),
  });
}

/** The account a short platform handle belongs to, for comparing two spellings. */
export function sameHandle(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (h: string | null | undefined) => (h ?? "").trim().replace(/^@/, "").toLowerCase();
  return clean(a) !== "" && clean(a) === clean(b);
}

/** The gate's name for each post counter column. One table, so a post reading
 *  and a post row are described to the gate the same way by every writer. */
export const POST_COUNTER_COLUMNS = {
  views: "viewsCount",
  likes: "likesCount",
  comments: "commentsCount",
  shares: "sharesCount",
  saves: "savesCount",
  reach: "reachCount",
} as const satisfies Partial<Record<GateCounter, string>>;

type PostCounterColumn = (typeof POST_COUNTER_COLUMNS)[keyof typeof POST_COUNTER_COLUMNS];

/** A post reading's or a post row's counters, by the gate's names. A column the
 *  source does not carry (unread, or not selected) stays absent. */
export function postGateCounts(
  src: Partial<Record<PostCounterColumn, number | null | undefined>>,
): Partial<Record<GateCounter, number | null | undefined>> {
  const out: Partial<Record<GateCounter, number | null | undefined>> = {};
  for (const [counter, column] of Object.entries(POST_COUNTER_COLUMNS) as [GateCounter, PostCounterColumn][]) {
    if (typeof src[column] === "number") out[counter] = src[column];
  }
  return out;
}
