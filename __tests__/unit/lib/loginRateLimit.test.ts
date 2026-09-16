/**
 * lib/loginRateLimit — the throttle on the workspace sign-in.
 *
 * Measured against production on 2026-09-16, before this existed: ten wrong
 * passwords in 3.5 seconds, all served in about 340ms, no throttle and no
 * lockout. The tests that matter are therefore the ones that would catch this
 * silently going back to unlimited -- a bucket that never fills, or a bucket an
 * attacker can sidestep by changing something they control.
 */
import {
  checkLoginAttempt,
  loginAttemptsPerMinute,
  LOGIN_WINDOW_MS,
} from "@/lib/loginRateLimit";

/* The bucket store is module state in lib/rateLimit, so each test needs its own
   address and IP rather than a reset hook the helper does not expose. */
let n = 0;
const freshEmail = () => `probe-${++n}-${Date.now()}@example.com`;
const freshIp = () => `203.0.113.${(n % 250) + 1}`;

describe("checkLoginAttempt", () => {
  it("allows attempts up to the limit and refuses the one after", () => {
    const email = freshEmail();
    const ip = freshIp();
    const limit = loginAttemptsPerMinute();

    for (let i = 0; i < limit; i++) {
      expect(checkLoginAttempt(email, ip)).toEqual({ allowed: true });
    }
    const denied = checkLoginAttempt(email, ip);
    expect(denied.allowed).toBe(false);
    if (denied.allowed) throw new Error("unreachable");
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
  });

  it("counts one address across changing IPs, which is what credential stuffing looks like", () => {
    const email = freshEmail();
    const limit = loginAttemptsPerMinute();
    for (let i = 0; i < limit; i++) {
      expect(checkLoginAttempt(email, `198.51.100.${i + 1}`).allowed).toBe(true);
    }
    expect(checkLoginAttempt(email, "198.51.100.200").allowed).toBe(false);
  });

  it("counts one host across changing addresses, which is what a list-walk looks like", () => {
    const ip = freshIp();
    const limit = loginAttemptsPerMinute();
    for (let i = 0; i < limit; i++) {
      expect(checkLoginAttempt(freshEmail(), ip).allowed).toBe(true);
    }
    expect(checkLoginAttempt(freshEmail(), ip).allowed).toBe(false);
  });

  it("does not hand out a fresh bucket for a different capitalisation or stray spaces", () => {
    /* The IP varies on every attempt on purpose. Holding it fixed lets the host
       bucket fill and deny the last call on its own, which passes this test
       whether or not the address is normalised at all -- measured: with the
       trim/lower-case removed, the fixed-IP version of this test still passed. */
    const email = freshEmail();
    const limit = loginAttemptsPerMinute();
    for (let i = 0; i < limit; i++) {
      const spelling = i % 2 === 0 ? `  ${email.toUpperCase()}  ` : email;
      expect(checkLoginAttempt(spelling, `192.0.2.${i + 1}`).allowed).toBe(true);
    }
    expect(checkLoginAttempt(email.toUpperCase(), "192.0.2.201").allowed).toBe(false);
  });

  it("still limits by address when the request carries no usable IP", () => {
    /* Otherwise stripping the proxy headers would be the way around the whole
       thing. */
    const email = freshEmail();
    const limit = loginAttemptsPerMinute();
    for (let i = 0; i < limit; i++) {
      expect(checkLoginAttempt(email, null).allowed).toBe(true);
    }
    expect(checkLoginAttempt(email, null).allowed).toBe(false);
  });

  it("keeps one account's attempts off another account's budget", () => {
    const ip = freshIp();
    const victim = freshEmail();
    const limit = loginAttemptsPerMinute();
    for (let i = 0; i < limit; i++) checkLoginAttempt(victim, ip);
    expect(checkLoginAttempt(victim, ip).allowed).toBe(false);
    /* A different address from a different host is unaffected -- the throttle
       must not become a way to lock somebody else out. */
    expect(checkLoginAttempt(freshEmail(), freshIp()).allowed).toBe(true);
  });
});

describe("loginAttemptsPerMinute", () => {
  const original = process.env.LOGIN_RATE_LIMIT_PER_MINUTE;
  afterEach(() => {
    if (original === undefined) delete process.env.LOGIN_RATE_LIMIT_PER_MINUTE;
    else process.env.LOGIN_RATE_LIMIT_PER_MINUTE = original;
  });

  it("defaults to 10 when the environment says nothing", () => {
    delete process.env.LOGIN_RATE_LIMIT_PER_MINUTE;
    expect(loginAttemptsPerMinute()).toBe(10);
  });

  it("takes a valid override from the environment", () => {
    process.env.LOGIN_RATE_LIMIT_PER_MINUTE = "25";
    expect(loginAttemptsPerMinute()).toBe(25);
  });

  it("falls back rather than coercing a malformed or zero value", () => {
    /* A limit of 0 would reject every sign-in on the platform, so an empty or
       broken env var must never read as one. */
    for (const bad of ["", "0", "-5", "abc", "2.5"]) {
      process.env.LOGIN_RATE_LIMIT_PER_MINUTE = bad;
      expect(loginAttemptsPerMinute()).toBe(10);
    }
  });
});
