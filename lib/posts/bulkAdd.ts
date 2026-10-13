/**
 * How the Add posts dialog walks a pasted batch, and how it decides what
 * happened to a link the server never answered for.
 *
 * Lives apart from PostsTab so the rules can be tested without rendering it.
 * The server route and its TikTok pacer are deliberately untouched: the route
 * still reads one link at a time at its own pace (plan §04, §12 F14). Only the
 * page changes.
 *
 * The failure this exists for was measured, not imagined. Past about ten links,
 * a request outlived the dialog's 25s wait -- its TikTok read was queued behind
 * the per-instance pacer, or sitting in a sandbox read -- and the dialog
 * printed "No answer in 25s — not added" for a post the server went on to
 * save. Worse, it then sent the next link while the first was still running,
 * so the server was working two adds at once and the queue grew with every
 * row. Two rules follow:
 *
 *  - A link with no answer is reconciled before it is called anything: the
 *    server is asked whether the post is now in the campaign, and keeps being
 *    asked for as long as an unanswered add could still be running. The next
 *    link on the same platform is not sent until then, so no platform's reads
 *    overlap on the server either.
 *  - Only a link the server confirms is absent reads "not added". One it could
 *    not be asked about says so, rather than guessing in either direction.
 *
 * Platforms run side by side, though (runInLanes). Strictly one link at a time
 * made a paste of one TikTok, one reel and one YouTube video wait for each
 * platform's read in turn -- 6.5s + 10.3s + 5.8s, 22.7s in all on the demo
 * database (walkthrough 2026-10-13, A1#4) -- when the pacer and the rate limits
 * that rule protects are each per platform.
 */
import { detectPlatform } from "@/lib/platforms/postUrl";

/** Links per group. The plan's "at most 10 per request" -- see groupIndices. */
export const ADD_GROUP_SIZE = 10;

/** Breathing room between groups, a little over the TikTok pacer's 1.5s gap
 *  plus its jitter, so one group's last read has cleared before the next starts. */
export const ADD_GROUP_PAUSE_MS = 2_000;

/**
 * When an unanswered link is asked about again, as waits before each ask.
 *
 * About ninety seconds in all. An add that outlived 25s is in a platform read:
 * the direct fetch gives up at 8s, but a sandbox read is allowed 30s on top of
 * the sandbox starting, and the first metrics read on a brand new creator adds
 * a profile read to that. Early asks are close together because most late adds
 * land within seconds of the wait running out.
 */
export const SETTLE_POLL_DELAYS_MS: readonly number[] = [2_000, 4_000, 6_000, 8_000, 10_000, 15_000, 20_000, 25_000];

/**
 * The submit order, cut into groups of at most `size`.
 *
 * Each group is still sent one link per request, one request at a time. The
 * add route takes one link, and the plan rules out a server-side batch route:
 * a batch read on the server is what defeats the per-instance pacer (§12 F14).
 * So "at most ten per request" is met with one, and the groups are what the
 * operator sees and what the pause between them is keyed on.
 */
export function groupIndices<T>(items: readonly T[], size: number = ADD_GROUP_SIZE): T[][] {
  const step = Math.max(1, Math.floor(size));
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += step) groups.push(items.slice(i, i + step));
  return groups;
}

/**
 * How many platforms are added to at once.
 *
 * The one-at-a-time rule above guards the TikTok pacer and each platform's own
 * rate limit, and a TikTok read spends none of Instagram's or YouTube's. So
 * links on different platforms go in parallel lanes while each lane stays one
 * link at a time with its group pause -- a mixed paste now takes about as long
 * as its slowest platform rather than the sum of all of them. Three, not one
 * per platform, so a paste across every platform still puts at most three adds
 * on the server at once.
 */
export const ADD_PLATFORM_LANES = 3;

/** The submit order split by platform, keeping each link's order within its lane. */
export function platformLanes<T>(items: readonly T[], platformOf: (item: T) => string | null | undefined): T[][] {
  const lanes = new Map<string, T[]>();
  for (const item of items) {
    const key = platformOf(item) ?? "";
    const lane = lanes.get(key);
    if (lane) lane.push(item);
    else lanes.set(key, [item]);
  }
  return [...lanes.values()];
}

/**
 * Works through the lanes with at most `limit` going at once. Inside a lane,
 * one item at a time, and a pause after every group of `groupSize` -- the same
 * groups and pause the batch always had, now kept per platform. A lane that
 * finishes hands its slot to the next one waiting.
 */
export async function runInLanes<T>(
  lanes: readonly (readonly T[])[],
  work: (item: T) => Promise<void>,
  opts: { sleep: (ms: number) => Promise<void>; limit?: number; groupSize?: number; groupPauseMs?: number },
): Promise<void> {
  const limit = Math.max(1, Math.floor(opts.limit ?? ADD_PLATFORM_LANES));
  const groupPauseMs = opts.groupPauseMs ?? ADD_GROUP_PAUSE_MS;
  let next = 0;
  const worker = async () => {
    while (next < lanes.length) {
      const groups = groupIndices(lanes[next++], opts.groupSize);
      for (let g = 0; g < groups.length; g++) {
        if (g > 0) await opts.sleep(groupPauseMs);
        for (const item of groups[g]) await work(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, lanes.length) }, worker));
}

/** What asking the server about one link established. */
export type SaveVerdict = "saved" | "absent" | "unknown";

/**
 * Whether a stored post is the one this link was sent as.
 *
 * The exact link first: the add route stores postUrl exactly as it was sent, so
 * a post our own request created always matches it. Then the post id, the same
 * identity the server's duplicate check uses, so a copy filed from a differently
 * decorated share link counts too.
 *
 * Not narrowed to the link's platform, unlike the server's check. A post whose
 * first metrics read failed is stored under the default platform (TikTok)
 * whatever the link was, and narrowing would call that saved post absent.
 */
export function postIsLink(post: { postUrl?: string | null; platformPostId?: string | null }, url: string): boolean {
  const postUrl = post.postUrl ?? "";
  const platformPostId = post.platformPostId ?? "";
  if (postUrl === url || platformPostId === url) return true;
  const detected = detectPlatform(url);
  if (!detected?.id) return false;
  return platformPostId === detected.id || platformPostId.includes(detected.id) || postUrl.includes(detected.id);
}

/**
 * The precheck route's answer about one link. `body` is null when the request
 * failed or did not come back -- which says nothing either way.
 */
export function verdictFromPrecheck(
  body: { results?: { url: string; inThisCampaign?: unknown }[] } | null,
  url: string,
): SaveVerdict {
  const row = body?.results?.find((r) => r.url === url);
  if (!row) return "unknown";
  return row.inThisCampaign ? "saved" : "absent";
}

/** The campaign's post list as the tab reads it; null when it could not be read. */
export function verdictFromPostList(
  posts: readonly { postUrl?: string | null; platformPostId?: string | null }[] | null,
  url: string,
): SaveVerdict {
  if (!posts) return "unknown";
  return posts.some((p) => postIsLink(p, url)) ? "saved" : "absent";
}

/** Saved beats everything; a confirmed absence beats not knowing. */
export function combineVerdicts(verdicts: readonly SaveVerdict[]): SaveVerdict {
  if (verdicts.includes("saved")) return "saved";
  if (verdicts.includes("absent")) return "absent";
  return "unknown";
}

/**
 * Ask until the post shows up or an unanswered add could no longer be running.
 *
 * `check` is the cheap question (the precheck). It is asked after each wait in
 * `delays`, and the first "saved" ends it. "absent" does not: an add still in
 * its platform read has simply not written the row yet. Two unanswered asks in
 * a row end it early, because a server that cannot be reached will not be
 * reached by asking it for another minute.
 *
 * `finalCheck`, when given, is asked once at the end if nothing was found -- a
 * second, differently built read, so "absent" is never one query's word alone.
 */
export async function settleVerdict(
  check: () => Promise<SaveVerdict>,
  opts: {
    delays: readonly number[];
    sleep: (ms: number) => Promise<void>;
    finalCheck?: () => Promise<SaveVerdict>;
  },
): Promise<SaveVerdict> {
  const seen: SaveVerdict[] = [];
  let unanswered = 0;
  for (const delay of opts.delays) {
    if (delay > 0) await opts.sleep(delay);
    const verdict = await check();
    if (verdict === "saved") return "saved";
    seen.push(verdict);
    unanswered = verdict === "unknown" ? unanswered + 1 : 0;
    if (unanswered >= 2) break;
  }
  if (opts.finalCheck) {
    const last = await opts.finalCheck();
    if (last === "saved") return "saved";
    seen.push(last);
  }
  return combineVerdicts(seen);
}

/** Why a link got no usable answer from the add itself. */
export type UnansweredKind = "timeout" | "network" | "server";

/**
 * The row's words for a link that was reconciled and is not in the campaign.
 *
 * "Not added" only when the server said so. When it could not be asked, the
 * row says that instead, and points at the retry that settles it: submitting
 * again either adds the post or is told it is already here.
 */
export function unansweredRowMessage(
  kind: UnansweredKind,
  verdict: Exclude<SaveVerdict, "saved">,
  opts: { timeoutSeconds?: number; serverMessage?: string } = {},
): string {
  const seconds = opts.timeoutSeconds ?? 25;
  if (verdict === "unknown") {
    const lead =
      kind === "timeout"
        ? `No answer in ${seconds}s`
        : kind === "network"
          ? "Could not reach the server"
          : opts.serverMessage ?? "The server reported an error";
    return `${lead}, and we could not check whether it was saved. Submit again — a saved post will show as already in this campaign.`;
  }
  if (kind === "timeout") return `No answer in ${seconds}s, and it is not in the campaign — not added. Submit again to retry.`;
  if (kind === "network") return "Could not reach the server — not added. Submit again to retry.";
  return opts.serverMessage ?? "The server reported an error — not added. Submit again to retry.";
}

/**
 * How one row ended, for the summary.
 *
 * "added" and "late" were both saved by this run; "late" is one the add itself
 * never answered for, which the summary still counts as added -- that is the
 * whole point. "already" covers both a link the precheck found in the campaign
 * before anything was sent and a server refusal for the same reason.
 */
export type AddRowOutcome =
  | { kind: "added" | "late" | "already" | "repeat" }
  | { kind: "failed"; reason: string };

export type AddRunSummary = {
  added: number;
  already: number;
  repeats: number;
  /** Reasons, most common first, each with how many rows gave it. */
  failed: { reason: string; count: number }[];
  failedTotal: number;
};

export function summariseAddRun(outcomes: readonly AddRowOutcome[]): AddRunSummary {
  let added = 0;
  let already = 0;
  let repeats = 0;
  const reasons = new Map<string, number>();
  for (const o of outcomes) {
    if (o.kind === "added" || o.kind === "late") added += 1;
    else if (o.kind === "already") already += 1;
    else if (o.kind === "repeat") repeats += 1;
    else if (o.kind === "failed") reasons.set(o.reason, (reasons.get(o.reason) ?? 0) + 1);
  }
  const failed = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { added, already, repeats, failed, failedTotal: failed.reduce((n, f) => n + f.count, 0) };
}

/** "48 added · 2 already here · 1 not added". Parts with nothing in them are left out. */
export function addRunSummaryText(s: AddRunSummary): string {
  const parts = [
    `${s.added} added`,
    s.already > 0 ? `${s.already} already here` : null,
    s.repeats > 0 ? `${s.repeats} pasted twice` : null,
    s.failedTotal > 0 ? `${s.failedTotal} not added` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** One line per reason a row was not added, with a count where it repeats:
 *  "Not a post link we recognise — this platform isn't supported yet. (2)". */
export function addRunReasonsText(s: AddRunSummary): string {
  return s.failed.map((f) => (f.count > 1 ? `${f.reason} (${f.count})` : f.reason)).join("\n");
}

export type AddProgress = {
  /** Links that have finished, whichever way, among those being sent. */
  done: number;
  total: number;
  /** An add got no answer and the server is being asked whether it saved. */
  checking: boolean;
};

/**
 * "Adding 37 posts… 14 done". Counted by what has finished, not by which link
 * is being sent: with platforms running side by side several are in flight at
 * once, so "Adding 3 of 3" would have been on screen from the first second.
 */
export function addProgressText(p: AddProgress): string {
  const head = p.total === 1 ? "Adding 1 post…" : `Adding ${p.total} posts… ${p.done} done`;
  const tail = p.checking ? " · no answer yet, checking whether it was saved" : "";
  return `${head}${tail}`;
}
