import { shouldAlertOnBatch } from "@/lib/alerts";

/**
 * This threshold is the only thing standing between "useful alert" and "inbox
 * the operator learns to ignore", so the boundaries matter more than the happy
 * path. A few failures in a big batch is normal (deleted post, private
 * account); most of a batch failing is an outage.
 */
describe("shouldAlertOnBatch", () => {
  it("stays quiet for the routine trickle of failures", () => {
    // 4 of 50 is a handful of deleted posts, not an incident.
    expect(shouldAlertOnBatch({ failed: 4, total: 50 })).toBe(false);
  });

  it("fires when most of the batch fails", () => {
    expect(shouldAlertOnBatch({ failed: 47, total: 50 })).toBe(true);
  });

  it("respects minFailures even when the ratio looks catastrophic", () => {
    // 3/3 is 100% but far too small a sample to wake anyone at 3am.
    expect(shouldAlertOnBatch({ failed: 3, total: 3 })).toBe(false);
  });

  it("fires at exactly the default ratio once minFailures is met", () => {
    expect(shouldAlertOnBatch({ failed: 5, total: 10 })).toBe(true);
  });

  it("stays quiet just below the default ratio", () => {
    expect(shouldAlertOnBatch({ failed: 5, total: 11 })).toBe(false);
  });

  it("never divides by zero on an empty batch", () => {
    expect(shouldAlertOnBatch({ failed: 0, total: 0 })).toBe(false);
    // A nonzero failure count with no total is incoherent input, not an alert.
    expect(shouldAlertOnBatch({ failed: 9, total: 0 })).toBe(false);
  });

  it("honours caller-supplied thresholds", () => {
    expect(shouldAlertOnBatch({ failed: 2, total: 10, minFailures: 1, ratio: 0.2 })).toBe(true);
    expect(shouldAlertOnBatch({ failed: 9, total: 10, minFailures: 20 })).toBe(false);
  });
});
