import { createLogger } from "@/lib/observability/logger";
import { InstagramAuthError, InstagramRateLimitError, type GraphHeadersListener } from "./instagram";
import { businessDiscoveryToken, type DiscoveryReadOptions } from "./instagramBusinessDiscovery";
import {
  getAgencyDiscoveryCredential,
  markAgencyCredentialRejected,
  peekAgencyCredential,
} from "./instagramAgencyCredential";

/**
 * Business Discovery's two tokens (plan §13 B): A, the one there has always
 * been (the credential store, then INSTAGRAM_BUSINESS_TOKEN), and an optional
 * standby B -- a second Instagram professional account, which brings its own
 * 200 calls an hour.
 *
 * The rule is small on purpose:
 *   - every read goes to A;
 *   - once A reports a rate limit -- an error code 4/17/32/613, or a usage
 *     header at USAGE_SWITCH_PERCENT or above -- reads go to B for the rest of
 *     that window, and the read that was refused is retried on B at once;
 *   - with B unset there is nothing to switch to, and a read behaves exactly
 *     as it did before this module: one token, every read, whatever it answers;
 *   - when both are limited the answer is a rate limit (InstagramRateLimitError),
 *     which every caller already files as "rate-limited" and never as a 0 or
 *     as a personal account.
 *
 * The window is Meta's own when it states one (estimated_time_to_regain_access,
 * in minutes, on x-business-use-case-usage), otherwise an hour -- the length of
 * the rolling window the 200-calls-an-hour figure is measured over.
 *
 * State is per process. A cold instance learns A is limited from its first
 * refused call, which costs one wasted request, not a wrong number. Nothing
 * here is tenant data: no handle, no token and no account id is ever logged,
 * only which slot and the usage percentages Meta reported.
 *
 * Background readers pass stopAtPercent and stop BELOW the limit, so that what
 * a person is waiting on still has room (2026-10-03: the 2-hourly creator sweep
 * read 63-79 profiles in a burst and hit code 4 in the same hour the post sweep
 * ran, and the post reads were refused). Crons stop at a fresh usage reading at
 * or above their threshold, or while a slot is known to be limited -- even with
 * one token, where an interactive read is still asked. A deferral makes no call
 * and throws InstagramDeferredError, a rate limit to every caller that already
 * handles one. Interactive reads pass nothing and behave as before.
 *
 * A read that names its org goes first to that org's own account when it has
 * one (lib/platforms/instagramAgencyCredential), with its own usage and limit
 * state. A limit there is that org's answer and never spills onto A or B, whose
 * hour belongs to every org without an account of its own. Only a token Meta
 * rejects outright sends the org back to A and B, until it reconnects.
 */

export type DiscoverySlot = "A" | "B" | "org";

export type DiscoveryCredential = {
  slot: DiscoverySlot;
  token: string;
  /** Spread into fetchInstagramProfile / fetchInstagramPublicPostMetrics. */
  graphOptions: Pick<DiscoveryReadOptions, "igUserId" | "onHeaders">;
};

export type DiscoveryOutcome<T> =
  | { ok: true; value: T; slot: DiscoverySlot; via?: { username: string } }
  | { ok: false; reason: "no-credentials" };

/** At or above this share of any limit Meta reports, the token counts as limited. */
export const USAGE_SWITCH_PERCENT = 95;
/** The post sweeps stop here, leaving the rest of the hour to Refresh. */
export const POST_SWEEP_STOP_PERCENT = 80;
/** Creator trackers, roster and avatar refreshes stop here, leaving room for posts. */
export const TRACKER_SWEEP_STOP_PERCENT = 60;
/** A usage reading older than this says too little about the window now to stop on. */
export const USAGE_FRESH_MS = 10 * 60 * 1000;

/** A background read not made, because Meta's last usage reading was at or past the reader's threshold. */
export class InstagramDeferredError extends InstagramRateLimitError {
  constructor(
    code: number,
    readonly usagePercent: number | null,
    readonly stopAtPercent: number,
  ) {
    super(code);
    this.name = "InstagramDeferredError";
    this.message =
      usagePercent === null
        ? `deferred: token rate-limited, background reads wait for the window`
        : `deferred: Meta usage at ${Math.round(usagePercent)}%, background reads stop at ${stopAtPercent}%`;
  }
}
/** How long a limited token is left alone when Meta does not say. */
export const DEFAULT_LIMIT_WINDOW_MS = 60 * 60 * 1000;
/** Usage is logged at most this often per token, so a sync of two hundred
 *  posts writes a handful of lines rather than four hundred. */
export const USAGE_LOG_EVERY_MS = 60_000;
/** From this share up, every usage reading is logged, as a warning. */
export const USAGE_WARN_PERCENT = 80;

export const TOKEN_B_ENV = "INSTAGRAM_BD_TOKEN_B";
export const TOKEN_B_USER_ID_ENV = "INSTAGRAM_BD_USER_ID_B";

type SlotState = { limitedUntil: number; lastCode: number; usageLoggedAt: number; usagePercent: number; usageAt: number };

const fresh = (): SlotState => ({ limitedUntil: 0, lastCode: 4, usageLoggedAt: 0, usagePercent: 0, usageAt: 0 });
/* "A", "B", and "org:<orgId>" for each org's own account. */
let state: Record<string, SlotState> = { A: fresh(), B: fresh() };

const slotState = (key: string): SlotState => (state[key] ??= fresh());
const orgKey = (orgId: string) => `org:${orgId}`;

/** For tests. */
export function resetDiscoveryTokenState() {
  state = { A: fresh(), B: fresh() };
}

const log = () => createLogger({ context: { platform: "INSTAGRAM", call: "businessDiscovery.tokens" } });

export type GraphUsage = {
  /** x-app-usage: call_count, total_cputime, total_time, each a percentage. */
  app?: { calls: number; cpu: number; time: number };
  /** x-business-use-case-usage: the highest percentage across its entries. */
  bucPercent?: number;
  /** Minutes until Meta lets the token back in, when it says. */
  regainMinutes?: number;
  /** The highest percentage anywhere in either header. */
  maxPercent: number;
};

const pctOf = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

type UsageEntry = {
  call_count?: unknown;
  total_cputime?: unknown;
  total_time?: unknown;
  estimated_time_to_regain_access?: unknown;
};

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pure: Meta's two usage headers, or null when neither is present or readable. */
export function parseGraphUsage(headers: { get(name: string): string | null }): GraphUsage | null {
  const app = parseJson(headers.get("x-app-usage"));
  const buc = parseJson(headers.get("x-business-use-case-usage"));
  if (!app && !buc) return null;

  const out: GraphUsage = { maxPercent: 0 };
  if (app) {
    out.app = { calls: pctOf(app.call_count), cpu: pctOf(app.total_cputime), time: pctOf(app.total_time) };
    out.maxPercent = Math.max(out.app.calls, out.app.cpu, out.app.time);
  }
  if (buc) {
    /* Keyed by a business or IG user id, each holding a list of use cases.
       Only the numbers are kept; the id is never carried any further. */
    let bucMax = 0;
    let regain = 0;
    for (const entries of Object.values(buc)) {
      if (!Array.isArray(entries)) continue;
      for (const e of entries as (UsageEntry | null)[]) {
        bucMax = Math.max(bucMax, pctOf(e?.call_count), pctOf(e?.total_cputime), pctOf(e?.total_time));
        regain = Math.max(regain, pctOf(e?.estimated_time_to_regain_access));
      }
    }
    out.bucPercent = bucMax;
    if (regain > 0) out.regainMinutes = regain;
    out.maxPercent = Math.max(out.maxPercent, bucMax);
  }
  return out;
}

function markLimited(slot: string, nowMs: number, why: string, regainMinutes?: number, code?: number) {
  const s = slotState(slot);
  const until = nowMs + (regainMinutes && regainMinutes > 0 ? regainMinutes * 60_000 : DEFAULT_LIMIT_WINDOW_MS);
  const wasLimited = s.limitedUntil > nowMs;
  s.limitedUntil = Math.max(s.limitedUntil, until);
  if (typeof code === "number") s.lastCode = code;
  if (!wasLimited) {
    log().warn("Business Discovery token is rate-limited", {
      slot,
      why,
      until: new Date(s.limitedUntil).toISOString(),
    });
  }
}

function usageListener(slot: string, now: () => number): GraphHeadersListener {
  return (headers) => {
    const usage = parseGraphUsage(headers);
    if (!usage) return;
    const nowMs = now();
    const s = slotState(slot);
    s.usagePercent = usage.maxPercent;
    s.usageAt = nowMs;
    const warn = usage.maxPercent >= USAGE_WARN_PERCENT;
    if (warn || nowMs - s.usageLoggedAt >= USAGE_LOG_EVERY_MS) {
      s.usageLoggedAt = nowMs;
      const facts = {
        slot,
        appCallPct: usage.app?.calls,
        appCpuPct: usage.app?.cpu,
        appTimePct: usage.app?.time,
        bucPct: usage.bucPercent,
        regainMinutes: usage.regainMinutes,
      };
      if (warn) log().warn("Graph usage near the limit", facts);
      else log().info("Graph usage", facts);
    }
    if (usage.maxPercent >= USAGE_SWITCH_PERCENT) {
      markLimited(slot, nowMs, `usage ${Math.round(usage.maxPercent)}%`, usage.regainMinutes);
    }
  };
}

function tokenB(env: Record<string, string | undefined>): { token: string; igUserId?: string } | null {
  const token = env[TOKEN_B_ENV]?.trim();
  if (!token) return null;
  const igUserId = env[TOKEN_B_USER_ID_ENV]?.trim();
  return igUserId ? { token, igUserId } : { token };
}

/** Why a background reader should not ask this slot now, or null when it may. */
function deferral(slot: string, nowMs: number, stopAtPercent: number | undefined): InstagramDeferredError | null {
  if (stopAtPercent === undefined) return null;
  const s = slotState(slot);
  if (s.limitedUntil > nowMs) return new InstagramDeferredError(s.lastCode, null, stopAtPercent);
  if (s.usageAt > 0 && nowMs - s.usageAt < USAGE_FRESH_MS && s.usagePercent >= stopAtPercent) {
    return new InstagramDeferredError(s.lastCode, s.usagePercent, stopAtPercent);
  }
  return null;
}

/**
 * Whether a background reader at this threshold would be deferred on every
 * configured token right now. A sweep asks before it claims a post, so a post
 * it is not going to read is left untouched and stays due, instead of being
 * stamped with an attempt that made no call.
 *
 * With an orgId whose own account is in the cache (loadAgencyDiscoveryCredentials),
 * only that account's state counts, since its reads never touch A or B.
 */
export function backgroundReadsDeferred(
  stopAtPercent: number,
  nowMs = Date.now(),
  env: Record<string, string | undefined> = process.env,
  orgId?: string,
): boolean {
  if (orgId && peekAgencyCredential(orgId, nowMs)) return deferral(orgKey(orgId), nowMs, stopAtPercent) !== null;
  const slots: DiscoverySlot[] = tokenB(env) ? ["A", "B"] : ["A"];
  return slots.every((slot) => deferral(slot, nowMs, stopAtPercent) !== null);
}

/** For the ops page and tests: the last usage each slot reported, and whether it is limited. */
export function discoveryUsageSnapshot(nowMs = Date.now()) {
  return (["A", "B"] as const).map((slot) => ({
    slot,
    usagePercent: state[slot].usageAt ? state[slot].usagePercent : null,
    usageAgeMs: state[slot].usageAt ? nowMs - state[slot].usageAt : null,
    limited: state[slot].limitedUntil > nowMs,
  }));
}

/** Whether a standby token is configured. Never its value. */
export function hasStandbyToken(env: Record<string, string | undefined> = process.env): boolean {
  return tokenB(env) !== null;
}

/**
 * Runs one Business Discovery read with the right token.
 *
 * `read` must ask Graph to throw on a rate limit (rateLimitThrows: true) and
 * spread `cred.graphOptions` into its call, or this cannot see the limit.
 * Every other error -- a rejected A, a timeout, a name with no account --
 * reaches the caller unchanged, so its existing handling still applies.
 */
export async function readWithDiscoveryToken<T>(
  read: (cred: DiscoveryCredential) => Promise<T>,
  {
    now = Date.now,
    env = process.env,
    stopAtPercent,
    orgId,
  }: {
    now?: () => number;
    env?: Record<string, string | undefined>;
    stopAtPercent?: number;
    /** The org the read is for. Its own Instagram account answers, when it has one. */
    orgId?: string;
  } = {},
): Promise<DiscoveryOutcome<T>> {
  const own = orgId ? await getAgencyDiscoveryCredential(orgId, now()) : null;
  if (orgId && own) {
    const key = orgKey(orgId);
    const wait = deferral(key, now(), stopAtPercent);
    if (wait) throw wait;
    const cred: DiscoveryCredential = {
      slot: "org",
      token: own.token,
      graphOptions: { igUserId: own.igUserId, onHeaders: usageListener(key, now) },
    };
    try {
      return { ok: true, value: await read(cred), slot: "org", via: { username: own.username } };
    } catch (e) {
      if (e instanceof InstagramRateLimitError) {
        markLimited(key, now(), `code ${e.code}`, undefined, e.code);
        throw e;
      }
      if (!(e instanceof InstagramAuthError)) throw e;
      log().error("agency Instagram account rejected; the org reads with the operator token until it reconnects", {
        orgId,
        status: e.status,
        code: e.code,
      });
      await markAgencyCredentialRejected(orgId, `Instagram refused this account (${e.message})`, new Date(now()));
    }
  }

  const a = await businessDiscoveryToken();
  const b = tokenB(env);
  const creds: DiscoveryCredential[] = [];
  if (a) creds.push({ slot: "A", token: a, graphOptions: { onHeaders: usageListener("A", now) } });
  if (b) {
    creds.push({
      slot: "B",
      token: b.token,
      graphOptions: { onHeaders: usageListener("B", now), ...(b.igUserId ? { igUserId: b.igUserId } : {}) },
    });
  }
  if (creds.length === 0) return { ok: false, reason: "no-credentials" };

  /* One token: today's behaviour exactly. Nothing to switch to, so nothing is
     skipped -- a limited token is still asked, and its answer still stands. */
  if (creds.length === 1) {
    const only = creds[0];
    const wait = deferral(only.slot, now(), stopAtPercent);
    if (wait) throw wait;
    try {
      return { ok: true, value: await read(only), slot: only.slot };
    } catch (e) {
      if (e instanceof InstagramRateLimitError) markLimited(only.slot, now(), `code ${e.code}`, undefined, e.code);
      throw e;
    }
  }

  let refusal: InstagramRateLimitError | null = null;
  for (const cred of creds) {
    const wait = deferral(cred.slot, now(), stopAtPercent);
    if (wait) {
      refusal ??= wait;
      continue;
    }
    if (state[cred.slot].limitedUntil > now()) {
      refusal ??= new InstagramRateLimitError(state[cred.slot].lastCode);
      continue;
    }
    try {
      return { ok: true, value: await read(cred), slot: cred.slot };
    } catch (e) {
      if (e instanceof InstagramRateLimitError) {
        markLimited(cred.slot, now(), `code ${e.code}`, undefined, e.code);
        refusal = e;
        continue;
      }
      /* B is the standby. A rejected B is an operator problem with the spare,
         not with A and not with the creator -- so it is said once, B is left
         alone for the window, and the read is answered as A left it. */
      if (cred.slot === "B" && e instanceof InstagramAuthError) {
        log().error(`${TOKEN_B_ENV} rejected; the standby token is unusable until it is replaced`, {
          status: e.status,
          code: e.code,
        });
        markLimited("B", now(), "token rejected");
        continue;
      }
      throw e;
    }
  }
  throw refusal ?? new InstagramRateLimitError(state.A.lastCode);
}
