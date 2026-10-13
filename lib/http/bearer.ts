import { timingSafeEqual } from "node:crypto";

/**
 * Whether an Authorization header is exactly `Bearer <secret>`, compared in
 * constant time.
 *
 * This is the one copy. There were 21 identical `tokenMatches` helpers in the
 * admin routes and another 19 sites comparing `Bearer ${CRON_SECRET}` with
 * `===`, which returns at the first differing byte and so tells a patient
 * caller how much of a guess was right. A shared secret is only as strong as
 * the weakest place that compares it, so they all come through here.
 *
 * Semantics are the ones every call site already had:
 *  - an unset or empty secret never matches, so a missing env var cannot turn
 *    into "Bearer undefined" being accepted, or into an open door;
 *  - no header never matches;
 *  - otherwise byte-for-byte equality with `Bearer <secret>`.
 *
 * The length check before timingSafeEqual is required, not an optimisation:
 * timingSafeEqual throws on buffers of different length. Leaking the length of
 * the expected value is accepted -- it is fixed and not secret.
 */
export function bearerMatches(
  header: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!secret || !header) return false;
  const presented = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
