import { configuredLimit } from "@/lib/rateLimit";

/* The signup cap became configurable so CI could have headroom over the five
   signups its suite spends. The value that matters is the one production uses,
   which is the fallback, because production sets no override. */
describe("configuredLimit", () => {
  it("falls back when the variable is absent", () => {
    expect(configuredLimit(undefined, 5)).toBe(5);
  });

  it("falls back on anything that is not a positive whole number", () => {
    for (const bad of ["", " ", "abc", "0", "-1", "2.5", "1e3.5", "NaN"]) {
      expect(configuredLimit(bad, 5)).toBe(5);
    }
  });

  it("accepts a raised cap", () => {
    expect(configuredLimit("100", 5)).toBe(100);
  });

  /* An empty or malformed value coerces to 0 under a bare Number(), and a cap
     of 0 rejects every request -- a self-inflicted outage on the signup path. */
  it("never yields zero", () => {
    for (const raw of [undefined, "", "0", "not-a-number"]) {
      expect(configuredLimit(raw, 5)).toBeGreaterThan(0);
    }
  });
});
