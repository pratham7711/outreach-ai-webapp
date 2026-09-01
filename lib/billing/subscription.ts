/**
 * Whether an agency may use the platform right now.
 *
 * This is the one piece of logic in the product that can lock a paying client
 * out of their own data, so it is pure, exhaustively tested, and deliberately
 * boring. Nothing here reads the database or the clock; both are passed in, so
 * every branch is reachable from a test.
 *
 * Three rules shaped it:
 *
 *   1. Suspension is a decision, never a side effect. Nothing auto-suspends
 *      because a date slid past — an unpaid agency enters PAST_DUE and is
 *      nagged, and a human chooses to cut them off. The alternative is
 *      discovering on a Monday that a client was locked out all weekend by a
 *      timezone.
 *   2. There is always a way back in. Platform staff are identified outside the
 *      tenant model entirely, because every user in this app belongs to an org
 *      and suspending an org would otherwise strand the only people who could
 *      unsuspend it.
 *   3. Read access outlives write access where it can. A suspended agency is
 *      not a deleted one; the data is theirs and they are presumably about to
 *      pay. Blocking login is what was asked for and is what this returns, but
 *      the shape below keeps "banner", "read-only" and "blocked" distinct so a
 *      softer default is a one-line change rather than a redesign.
 */

export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "SUSPENDED"
  | "CANCELLED";

export type AccessLevel = "full" | "warned" | "blocked";

export type AccessDecision = {
  level: AccessLevel;
  /** Machine-readable, for tests, logs and the login error. */
  reason:
    | "ok"
    | "trialing"
    | "trial_expired"
    | "past_due"
    | "suspended"
    | "cancelled"
    | "platform_admin";
  /** Shown to the user. Empty when there is nothing to say. */
  message: string;
};

export type OrgBillingState = {
  subscriptionStatus: SubscriptionStatus;
  /** End of the period they have paid for. Null means never paid. */
  paidThrough: Date | null;
  /** End of a trial, if they are on one. */
  trialEndsAt: Date | null;
};

/**
 * How long an agency keeps working after their paid period lapses.
 *
 * Not a kindness — a correctness margin. Payment is recorded by hand here, so
 * the gap between "they paid" and "someone typed it in" is a weekend at least.
 * Cutting access at the stroke of the period end would lock out clients whose
 * only failing is that nobody was at a desk.
 */
export const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function accessFor(
  org: OrgBillingState,
  now: Date,
  opts: { isPlatformAdmin?: boolean } = {}
): AccessDecision {
  // Rule 2, checked first and unconditionally: platform staff are never locked
  // out of a tenant, whatever that tenant's billing says. This is the only way
  // back from a mistaken suspension.
  if (opts.isPlatformAdmin) {
    return { level: "full", reason: "platform_admin", message: "" };
  }

  switch (org.subscriptionStatus) {
    case "SUSPENDED":
      return {
        level: "blocked",
        reason: "suspended",
        message:
          "Your workspace is suspended for non-payment. Contact your account manager to restore access — your data is intact.",
      };

    case "CANCELLED":
      return {
        level: "blocked",
        reason: "cancelled",
        message:
          "This workspace has been closed. Contact support if you believe this is a mistake.",
      };

    case "TRIALING": {
      if (org.trialEndsAt && now > org.trialEndsAt) {
        // An expired trial warns rather than blocks: someone forgot to convert
        // an account, and the person punished should not be the client.
        return {
          level: "warned",
          reason: "trial_expired",
          message: "Your trial has ended. Contact your account manager to continue.",
        };
      }
      return { level: "full", reason: "trialing", message: "" };
    }

    case "PAST_DUE": {
      const graceEnds = org.paidThrough
        ? new Date(org.paidThrough.getTime() + GRACE_DAYS * DAY_MS)
        : null;
      const daysLeft = graceEnds ? daysBetween(now, graceEnds) : 0;
      return {
        level: "warned",
        reason: "past_due",
        message:
          daysLeft > 0
            ? `Payment is overdue. Access continues for ${daysLeft} more day${daysLeft === 1 ? "" : "s"} while this is settled.`
            : "Payment is overdue. Access may be suspended shortly.",
      };
    }

    case "ACTIVE":
    default:
      return { level: "full", reason: "ok", message: "" };
  }
}

/** Convenience for the auth path, which only cares whether to let them in. */
export function canSignIn(
  org: OrgBillingState,
  now: Date,
  opts: { isPlatformAdmin?: boolean } = {}
): boolean {
  return accessFor(org, now, opts).level !== "blocked";
}

/**
 * Whether an agency has drifted past its paid period far enough to be worth a
 * human's attention. Deliberately returns a *suggestion*, never an action --
 * see rule 1.
 */
export function suspensionCandidates<T extends OrgBillingState & { id: string }>(
  orgs: T[],
  now: Date
): { org: T; daysOverdue: number }[] {
  return orgs
    .filter((o) => o.subscriptionStatus === "PAST_DUE" && o.paidThrough !== null)
    .map((o) => ({ org: o, daysOverdue: daysBetween(o.paidThrough as Date, now) }))
    .filter((c) => c.daysOverdue > GRACE_DAYS)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/**
 * Platform staff, identified outside the tenant model.
 *
 * An env list rather than a database column, because the failure this guards
 * against includes "the database says everyone is suspended". A value that can
 * be fixed by editing an environment variable and redeploying is recoverable;
 * a flag on a row inside the system you are locked out of is not.
 */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? "";
  const allowed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
