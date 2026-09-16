import { configuredLimit, rateLimit } from "@/lib/rateLimit";

/**
 * How many sign-in attempts an address, or a host, gets per minute.
 *
 * The creator portal's login has been rate limited since it was written
 * (app/api/portal/auth/login/route.ts, 10 a minute); the workspace login --
 * the door into an entire agency -- never was. Measured against production on
 * 2026-09-16: ten wrong passwords in 3.5 seconds, every one answered in about
 * 340ms, no throttle, no lockout, and the correct password still accepted
 * immediately afterwards.
 *
 * Two buckets, because they stop opposite attacks. The address bucket is what
 * credential stuffing runs into, where each guess at one account arrives from a
 * different host; the IP bucket catches the reverse, one host walking a list of
 * addresses. Neither writes anything to the user row, so there is no lockout
 * state an attacker could weaponise against somebody else's account -- the
 * window simply expires.
 *
 * Every attempt is counted, not only the failures, which is what the portal
 * does: at ten a minute a real sign-in never reaches the limit, and refunding a
 * success would cost a second call to buy nothing.
 *
 * NOTE the bucket store behind this is an in-process Map, so on Vercel the
 * count is per lambda instance rather than global -- the portal's behaviour
 * too. It raises the cost of a brute force by a large factor rather than
 * ending it; a shared store is the upgrade, not a different design.
 */
export const LOGIN_WINDOW_MS = 60_000;

const DEFAULT_LOGIN_ATTEMPTS_PER_MINUTE = 10;

export function loginAttemptsPerMinute(): number {
  return configuredLimit(
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE,
    DEFAULT_LOGIN_ATTEMPTS_PER_MINUTE
  );
}

export type LoginAttemptDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Consumes one attempt from the address bucket and one from the host bucket,
 * and reports whether this attempt may proceed.
 *
 * The address is lower-cased so that varying the capitalisation cannot buy a
 * fresh bucket. A request with no usable IP -- which is what a direct call with
 * no proxy headers looks like -- is still limited by address; skipping the
 * check entirely there would hand an attacker the way around it.
 */
export function checkLoginAttempt(
  email: string,
  ip: string | null
): LoginAttemptDecision {
  const limit = loginAttemptsPerMinute();
  const keys = [`login:email:${email.trim().toLowerCase()}`];
  if (ip) keys.push(`login:ip:${ip}`);

  for (const key of keys) {
    const rl = rateLimit({ key, limit, windowMs: LOGIN_WINDOW_MS });
    if (!rl.allowed) {
      return { allowed: false, retryAfterSeconds: rl.retryAfterSeconds };
    }
  }
  return { allowed: true };
}
